import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { hasCodexToken, hasCodexVendorPath, isCodexBinary } from "../../src/codexCmd.ts";

const execFileAsync = promisify(execFile);
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRoot = path.resolve(currentDir, "..", "..");

export type ConsensusServer = {
  port: number;
  inspectorPort?: number;
  output: string;
  stop: () => Promise<void>;
};

export type TmuxSession = {
  socketPath: string;
  sessionId: string;
  target: string;
  sendText: (text: string) => Promise<void>;
  capture: () => Promise<string>;
  panePid: () => Promise<number>;
  kill: () => Promise<void>;
};

const PANE_EXCERPT_CHARS = 1200;
const AUTH_PATTERN = /unauthorized|login|api key|missing bearer|not logged in|sign in/i;
const ERROR_PATTERN =
  /command not found|not recognized|no such file|cannot execute|permission denied|panic|fatal|traceback/i;
const DEFAULT_READY_PATTERNS = [
  /(?:^|\n)\s*codex(?:-cli)?[^\n]*[>]\s*$/im,
  /(?:^|\n)\s*[>]\s*$/m,
  /\bCodex\b.*\bready\b/i,
  /\bCodex\b.*\bhelp\b/i,
];

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

export async function isCodexAvailable(codexBin = "codex"): Promise<boolean> {
  try {
    await execFileAsync(codexBin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to acquire free port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export async function createTempProject(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-live-project-"));
  const srcDir = path.join(root, "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(root, "a.config.ts"), "export const A = 1;\n");
  await fs.writeFile(path.join(root, "b.config.ts"), "export const B = 2;\n");
  await fs.writeFile(path.join(root, "c.config.ts"), "export const C = 3;\n");
  await fs.writeFile(path.join(srcDir, "alpha.ts"), "export const alpha = 'alpha';\n");
  await fs.writeFile(path.join(srcDir, "beta.ts"), "export const beta = 'beta';\n");
  await fs.writeFile(path.join(srcDir, "gamma.ts"), "export const gamma = 'gamma';\n");
  await fs.writeFile(path.join(root, "README.md"), "Deterministic test project.\n");
  return {
    root,
    cleanup: async () => fs.rm(root, { recursive: true, force: true }),
  };
}

export async function createCodexHome(options?: {
  useRealHome?: boolean;
}): Promise<{
  home: string;
  root: string;
  cleanup: () => Promise<void>;
}> {
  const useRealHome =
    options?.useRealHome ??
    (process.env.RUN_LIVE_CODEX === "1" && process.env.CODEX_TEST_USE_REAL_HOME !== "0");
  if (useRealHome) {
    const root = os.homedir();
    const home = process.env.CODEX_HOME || path.join(root, ".codex");
    await fs.mkdir(path.join(home, "sessions"), { recursive: true });
    await fs.mkdir(path.join(home, "consensus"), { recursive: true });
    return {
      home,
      root,
      cleanup: async () => {},
    };
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-codex-home-"));
  const home = path.join(root, ".codex");
  await fs.mkdir(path.join(home, "sessions"), { recursive: true });
  await fs.mkdir(path.join(home, "consensus"), { recursive: true });
  return {
    home,
    root,
    cleanup: async () => fs.rm(root, { recursive: true, force: true }),
  };
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

export async function startConsensusServer(options: {
  port: number;
  codexHome: string;
  inspector?: boolean;
  debugActivity?: boolean;
  testHooks?: boolean;
  processMatch?: string;
  timeoutMs?: number;
}): Promise<ConsensusServer> {
  const args = [] as string[];
  if (options.inspector) {
    args.push("--inspect=0");
  }
  args.push("--import", "tsx", path.join(repoRoot, "src", "server.ts"));

  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CONSENSUS_PORT: String(options.port),
      CONSENSUS_HOST: "127.0.0.1",
      CONSENSUS_CODEX_HOME: options.codexHome,
      CONSENSUS_DEBUG_ACTIVITY: options.debugActivity ? "1" : "0",
      CODEX_TEST_HOOKS: options.testHooks ? "1" : "0",
      CONSENSUS_PROCESS_MATCH: options.processMatch,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const onOutput = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout?.on("data", onOutput);
  child.stderr?.on("data", onOutput);

  let inspectorPort: number | undefined;
  if (options.inspector && child.stderr) {
    inspectorPort = await waitForInspectorPort(child.stderr, 5000);
  }

  try {
    await waitForHttpOk(
      `http://127.0.0.1:${options.port}/health`,
      options.timeoutMs ?? 15000,
      child
    );
  } catch (err) {
    const trimmed = output.trim();
    const suffix = trimmed ? `\nServer output:\n${trimmed}` : "";
    throw new Error(`${(err as Error).message}${suffix}`);
  }

  const stop = async () => {
    if (child.killed) return;
    child.kill("SIGTERM");
    const exited = await waitForExit(child, 5000);
    if (!exited) {
      child.kill("SIGKILL");
      await waitForExit(child, 2000);
    }
  };

  return { port: options.port, inspectorPort, output, stop };
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
  try {
    await Promise.race([once(child, "exit"), delay(timeoutMs)]);
    return true;
  } catch {
    return false;
  }
}

async function waitForInspectorPort(
  stream: NodeJS.ReadableStream,
  timeoutMs: number
): Promise<number> {
  const start = Date.now();
  let buffer = "";
  return await new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/Debugger listening on ws:\/\/[^\s:]+:(\d+)\//);
      if (match) {
        cleanup();
        resolve(Number(match[1]));
      }
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("Timed out waiting for inspector port"));
    };
    const cleanup = () => {
      stream.off("data", onData);
      clearTimeout(timer);
    };
    stream.on("data", onData);
    const remaining = Math.max(0, timeoutMs - (Date.now() - start));
    const timer = setTimeout(onTimeout, remaining);
  });
}

async function waitForHttpOk(
  url: string,
  timeoutMs: number,
  child: ReturnType<typeof spawn>
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Server process exited with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function startTmuxSession(): Promise<TmuxSession> {
  const sessionId = `consensus-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const socketPath = path.join(os.tmpdir(), `${sessionId}.sock`);
  await execFileAsync("tmux", [
    "-f",
    "/dev/null",
    "-S",
    socketPath,
    "new-session",
    "-d",
    "-s",
    sessionId,
    "-n",
    "main",
    "-x",
    "120",
    "-y",
    "40",
  ]);
  const target = `${sessionId}:main.0`;
  const sendText = async (text: string) => {
    await execFileAsync("tmux", ["-S", socketPath, "send-keys", "-t", target, "-l", text]);
    await execFileAsync("tmux", ["-S", socketPath, "send-keys", "-t", target, "C-m"]);
  };
  const capture = async () => {
    const { stdout } = await execFileAsync("tmux", ["-S", socketPath, "capture-pane", "-p", "-t", target]);
    return stdout.toString();
  };
  const panePid = async () => {
    const { stdout } = await execFileAsync("tmux", [
      "-S",
      socketPath,
      "display-message",
      "-p",
      "-t",
      target,
      "#{pane_pid}",
    ]);
    const pid = Number(stdout.toString().trim());
    if (!Number.isFinite(pid)) {
      throw new Error("Failed to resolve tmux pane pid");
    }
    return pid;
  };
  const kill = async () => {
    try {
      await execFileAsync("tmux", ["-S", socketPath, "kill-server"]);
    } catch {
      // ignore
    }
  };
  return { socketPath, sessionId, target, sendText, capture, panePid, kill };
}

export async function waitForPaneOutput(
  session: TmuxSession,
  predicate: (output: string) => boolean,
  timeoutMs: number
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const output = await session.capture();
    if (predicate(output)) return output;
    await delay(200);
  }
  const output = await session.capture();
  const excerpt = formatPaneExcerpt(output);
  throw new Error(`Timed out waiting for tmux output.\nLast pane output:\n${excerpt}`);
}

function parsePsStart(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

function formatPaneExcerpt(output: string, maxChars = PANE_EXCERPT_CHARS): string {
  const cleaned = stripAnsi(output).replace(/\r/g, "").trim();
  if (!cleaned) return "<empty>";
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(-maxChars);
}

function firstMatchingLine(output: string, pattern: RegExp): string | undefined {
  const cleaned = stripAnsi(output).replace(/\r/g, "");
  for (const line of cleaned.split("\n")) {
    if (pattern.test(line)) return line.trim();
  }
  return undefined;
}

export async function waitForCodexReady(
  session: TmuxSession,
  timeoutMs: number
): Promise<{ output: string; authRequired: boolean; errorHint?: string }> {
  const start = Date.now();
  const readyPatterns = [...DEFAULT_READY_PATTERNS];
  const custom = process.env.CODEX_READY_REGEX;
  if (custom) {
    try {
      readyPatterns.unshift(new RegExp(custom, "i"));
    } catch {
      // ignore invalid regex
    }
  }
  while (Date.now() - start < timeoutMs) {
    const output = await session.capture();
    const cleaned = stripAnsi(output).replace(/\r/g, "");
    if (AUTH_PATTERN.test(cleaned)) {
      return { output: formatPaneExcerpt(output), authRequired: true };
    }
    const errorLine = firstMatchingLine(cleaned, ERROR_PATTERN);
    if (errorLine) {
      return {
        output: formatPaneExcerpt(output),
        authRequired: false,
        errorHint: errorLine,
      };
    }
    if (readyPatterns.some((pattern) => pattern.test(cleaned))) {
      return { output: formatPaneExcerpt(output), authRequired: false };
    }
    await delay(200);
  }
  const output = await session.capture();
  throw new Error(
    `Timed out waiting for codex ready.\nLast pane output:\n${formatPaneExcerpt(output)}`
  );
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

export async function waitForCodexPid(options: {
  startAfterMs: number;
  timeoutMs: number;
  codexBin?: string;
  panePid?: number;
  session?: TmuxSession;
}): Promise<number> {
  const codexBin = options.codexBin;
  const codexBase = codexBin ? path.basename(stripQuotes(codexBin)) : undefined;
  const codexBaseLower = codexBase?.toLowerCase();
  const start = Date.now();
  while (Date.now() - start < options.timeoutMs) {
    const { stdout } = await execFileAsync("ps", [
      "-ax",
      "-o",
      "pid=,ppid=,lstart=,command=",
    ]);
    const lines = stdout.toString().split("\n");
    const procInfo = new Map<
      number,
      { pid: number; ppid?: number; startedAt?: number; cmd: string }
    >();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 8) continue;
      const pid = Number(parts[0]);
      const ppid = Number(parts[1]);
      const startStr = parts.slice(2, 7).join(" ");
      const startedAt = parsePsStart(startStr);
      const cmd = parts.slice(7).join(" ");
      procInfo.set(pid, { pid, ppid, startedAt, cmd });
    }

    const isDescendant = (pid: number): boolean => {
      if (!options.panePid) return false;
      let current = procInfo.get(pid)?.ppid;
      const seen = new Set<number>();
      while (current && !seen.has(current)) {
        if (current === options.panePid) return true;
        seen.add(current);
        current = procInfo.get(current)?.ppid;
      }
      return false;
    };

    const candidates = Array.from(procInfo.values()).filter(
      (proc) => proc.startedAt && proc.startedAt >= options.startAfterMs - 2000
    );
    const codexCandidates = candidates.filter((proc) => {
      const cmd = proc.cmd;
      if (hasCodexToken(cmd) || hasCodexVendorPath(cmd)) return true;
      if (codexBaseLower && cmd.toLowerCase().includes(codexBaseLower)) return true;
      if (codexBin && isCodexBinary(codexBin) && cmd.toLowerCase().includes("codex")) return true;
      return false;
    });

    const prioritize = (list: typeof candidates) => {
      let best: { pid: number; startedAt: number } | null = null;
      for (const proc of list) {
        if (!proc.startedAt) continue;
        if (!best || proc.startedAt > best.startedAt) {
          best = { pid: proc.pid, startedAt: proc.startedAt };
        }
      }
      return best;
    };

    const codexDescendants = options.panePid
      ? codexCandidates.filter((proc) => isDescendant(proc.pid))
      : codexCandidates;
    const bestCodex = prioritize(codexDescendants.length > 0 ? codexDescendants : codexCandidates);
    if (bestCodex) return bestCodex.pid;

    if (options.panePid) {
      const descendantCandidates = candidates.filter(
        (proc) => proc.pid !== options.panePid && isDescendant(proc.pid)
      );
      const bestDescendant = prioritize(descendantCandidates);
      if (bestDescendant) return bestDescendant.pid;
    }
    await delay(200);
  }
  const paneOutput = options.session ? await options.session.capture() : "";
  const suffix = paneOutput
    ? `\nLast pane output:\n${formatPaneExcerpt(paneOutput)}`
    : "";
  throw new Error(`Timed out waiting for codex pid.${suffix}`);
}

export async function startCodexInteractiveInTmux(options: {
  session: TmuxSession;
  projectDir: string;
  codexHome: string;
  codexRoot: string;
  codexBin?: string;
  debugEnv?: string;
}): Promise<void> {
  const codexBin = options.codexBin || "codex";
  const debugEnv = options.debugEnv ?? "RUST_LOG=debug";
  const cmd =
    `env HOME=${shellQuote(options.codexRoot)} ` +
    `CODEX_HOME=${shellQuote(options.codexHome)} ` +
    `${debugEnv} ${shellQuote(codexBin)} ` +
    "--dangerously-bypass-approvals-and-sandbox --skip-git-repo-check " +
    `-C ${shellQuote(options.projectDir)}`;
  await options.session.sendText(cmd);
}

async function collectSessionFiles(dir: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSessionFiles(full)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const stat = await fs.stat(full);
    files.push({ path: full, mtimeMs: stat.mtimeMs });
  }
  return files;
}

export async function waitForSessionFile(
  codexHome: string,
  timeoutMs: number,
  afterMs?: number,
  session?: TmuxSession
): Promise<string> {
  const sessionsDir = path.join(codexHome, "sessions");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const fullPaths = await collectSessionFiles(sessionsDir);
      if (fullPaths.length > 0) {
        const filtered =
          typeof afterMs === "number"
            ? fullPaths.filter((entry) => entry.mtimeMs >= afterMs)
            : fullPaths;
        if (filtered.length > 0) {
          filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
          return filtered[0].path;
        }
      }
    } catch {
      // ignore
    }
    await delay(200);
  }
  const paneOutput = session ? await session.capture() : "";
  const suffix = paneOutput
    ? `\nLast pane output:\n${formatPaneExcerpt(paneOutput)}`
    : "";
  throw new Error(`Timed out waiting for codex session file in ${sessionsDir}.${suffix}`);
}

export async function fetchSnapshot(port: number): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
  if (!res.ok) {
    throw new Error(`Snapshot request failed: ${res.status}`);
  }
  return res.json();
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
