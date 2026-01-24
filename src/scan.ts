import psList from "ps-list";
import pidusage from "pidusage";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentKind, AgentSnapshot, SnapshotPayload, WorkSummary } from "./types.js";
import { deriveState } from "./activity.js";
import {
  listRecentSessions,
  pickSessionForProcess,
  resolveCodexHome,
  summarizeTail,
  updateTail,
} from "./codexLogs.js";
import { redactText } from "./redact.js";

const execFileAsync = promisify(execFile);
const repoCache = new Map<string, string | null>();

function isCodexProcess(cmd: string | undefined, name: string | undefined, matchRe?: RegExp): boolean {
  if (!cmd && !name) return false;
  if (matchRe) {
    return matchRe.test(cmd || "") || matchRe.test(name || "");
  }
  const cmdLine = cmd || "";
  if (name === "codex") return true;
  if (cmdLine === "codex" || cmdLine.startsWith("codex ")) return true;
  if (cmdLine.includes("/codex") || cmdLine.includes(" codex ")) return true;
  return false;
}

function inferKind(cmd: string): AgentKind {
  if (cmd.includes(" app-server")) return "app-server";
  if (cmd.includes(" exec")) return "exec";
  if (cmd.includes(" codex") || cmd.startsWith("codex")) return "tui";
  return "unknown";
}

function shortenCmd(cmd: string, max = 120): string {
  const clean = cmd.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

function parseDoingFromCmd(cmd: string): string | undefined {
  const parts = cmd.split(/\s+/g);
  const execIndex = parts.indexOf("exec");
  if (execIndex !== -1) {
    for (let i = execIndex + 1; i < parts.length; i += 1) {
      const part = parts[i];
      if (part === "--") {
        const next = parts[i + 1];
        return next ? `exec: ${next}` : "exec";
      }
      if (!part.startsWith("-")) {
        return `exec: ${part}`;
      }
    }
    return "exec";
  }
  const resumeIndex = parts.indexOf("resume");
  if (resumeIndex !== -1) {
    const token = parts[resumeIndex + 1];
    return token ? `resume: ${token}` : "resume";
  }
  const monitorIndex = parts.indexOf("monitor");
  if (monitorIndex !== -1) {
    return "monitor";
  }
  if (cmd.includes("app-server")) return "app-server";
  if (cmd.startsWith("codex")) return "codex";
  return undefined;
}

function normalizeTitle(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/^prompt:\s*/i, "").trim();
}

function deriveTitle(
  doing: string | undefined,
  repo: string | undefined,
  pid: number
): string {
  if (doing) {
    const trimmed = doing.trim();
    if (trimmed.startsWith("cmd:")) return `Run ${trimmed.slice(4).trim()}`;
    if (trimmed.startsWith("edit:")) return `Editing ${trimmed.slice(5).trim()}`;
    if (trimmed.startsWith("tool:")) return `Tool ${trimmed.slice(5).trim()}`;
    if (trimmed.startsWith("exec:")) return `Exec ${trimmed.slice(5).trim()}`;
    if (trimmed.startsWith("resume:")) return `Resume ${trimmed.slice(7).trim()}`;
  }
  if (repo) return repo;
  return `codex#${pid}`;
}

function sanitizeSummary(summary?: WorkSummary): WorkSummary | undefined {
  if (!summary) return undefined;
  const cleaned: WorkSummary = {};
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value !== "string") continue;
    cleaned[key as keyof WorkSummary] = redactText(value) || value;
  }
  return cleaned;
}

async function getCwdsForPids(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (pids.length === 0) return result;
  if (process.platform === "win32") return result;
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "pid=,cwd=",
      "-p",
      pids.join(","),
    ]);
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const cwd = match[2].trim();
      if (cwd) result.set(pid, cwd);
    }
  } catch {
    return result;
  }
  return result;
}

function findRepoRoot(cwd: string): string | null {
  if (repoCache.has(cwd)) return repoCache.get(cwd) || null;
  let current = cwd;
  while (true) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      repoCache.set(cwd, current);
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  repoCache.set(cwd, null);
  return null;
}

export async function scanCodexProcesses(): Promise<SnapshotPayload> {
  const matchEnv = process.env.CONSENSUS_PROCESS_MATCH;
  let matchRe: RegExp | undefined;
  if (matchEnv) {
    try {
      matchRe = new RegExp(matchEnv);
    } catch {
      matchRe = undefined;
    }
  }
  const processes = await psList();
  const codexProcs = processes.filter((proc) => isCodexProcess(proc.cmd, proc.name, matchRe));

  const pids = codexProcs.map((proc) => proc.pid);
  let usage: Record<number, pidusage.Status> = {};
  try {
    usage = (await pidusage(pids)) as Record<number, pidusage.Status>;
  } catch {
    usage = {};
  }

  const cwds = await getCwdsForPids(pids);
  const codexHome = resolveCodexHome();
  const sessions = await listRecentSessions(codexHome);

  const agents: AgentSnapshot[] = [];
  for (const proc of codexProcs) {
    const stats = usage[proc.pid] || ({} as pidusage.Status);
    const cpu = typeof stats.cpu === "number" ? stats.cpu : 0;
    const mem = typeof stats.memory === "number" ? stats.memory : 0;

    const elapsed = (stats as pidusage.Status & { elapsed?: number }).elapsed;
    const startMs = typeof elapsed === "number" ? Date.now() - elapsed : undefined;

    const session = pickSessionForProcess(sessions, startMs);
    let doing: string | undefined;
    let events: AgentSnapshot["events"];
    let model: string | undefined;
    let hasError = false;
    let title: string | undefined;
    let summary: WorkSummary | undefined;
    let lastEventAt: number | undefined;

    if (session) {
      const tail = await updateTail(session.path);
      if (tail) {
        const tailSummary = summarizeTail(tail);
        doing = tailSummary.doing;
        events = tailSummary.events;
        model = tailSummary.model;
        hasError = tailSummary.hasError;
        title = normalizeTitle(tailSummary.title);
        summary = tailSummary.summary;
        lastEventAt = tailSummary.lastEventAt;
      }
    }

    if (!doing) {
      doing =
        parseDoingFromCmd(proc.cmd || "") || shortenCmd(proc.cmd || proc.name || "");
    }
    if (!summary && doing) {
      summary = { current: doing };
    }

    const cwdRaw = cwds.get(proc.pid);
    const cwd = redactText(cwdRaw) || cwdRaw;
    const repoRoot = cwdRaw ? findRepoRoot(cwdRaw) : null;
    const repoName = repoRoot ? path.basename(repoRoot) : undefined;

    const state = deriveState({ cpu, hasError, lastEventAt });
    const cmdRaw = proc.cmd || proc.name || "";
    const cmd = redactText(cmdRaw) || cmdRaw;
    const cmdShort = shortenCmd(cmd);
    const kind = inferKind(cmd);
    const id = `${proc.pid}`;
    const startedAt = startMs ? Math.floor(startMs / 1000) : undefined;

    const computedTitle = title || deriveTitle(doing, repoName, proc.pid);
    const safeSummary = sanitizeSummary(summary);

    agents.push({
      id,
      pid: proc.pid,
      startedAt,
      lastEventAt,
      title: redactText(computedTitle) || computedTitle,
      cmd,
      cmdShort,
      kind,
      cpu,
      mem,
      state,
      doing: redactText(doing) || doing,
      sessionPath: redactText(session?.path) || session?.path,
      repo: repoName,
      cwd,
      model,
      summary: safeSummary,
      events,
    });
  }

  return { ts: Date.now(), agents };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("scan.js");
if (isDirectRun) {
  scanCodexProcesses()
    .then((snapshot) => {
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
