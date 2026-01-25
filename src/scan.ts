import psList from "ps-list";
import pidusage from "pidusage";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentKind, AgentSnapshot, SnapshotPayload, WorkSummary } from "./types.js";
import { deriveStateWithHold } from "./activity.js";
import {
  listRecentSessions,
  findSessionById,
  pickSessionForProcess,
  resolveCodexHome,
  summarizeTail,
  updateTail,
} from "./codexLogs.js";
import { getOpenCodeSessions } from "./opencodeApi.js";
import { ensureOpenCodeServer } from "./opencodeServer.js";
import {
  ensureOpenCodeEventStream,
  getOpenCodeActivityByPid,
  getOpenCodeActivityBySession,
} from "./opencodeEvents.js";
import { getOpenCodeSessionForDirectory } from "./opencodeStorage.js";
import { deriveOpenCodeState } from "./opencodeState.js";
import { deriveClaudeState, getClaudeCpuThreshold, summarizeClaudeCommand } from "./claudeCli.js";
import { redactText } from "./redact.js";

const execFileAsync = promisify(execFile);
const repoCache = new Map<string, string | null>();
const activityCache = new Map<
  string,
  { lastActiveAt?: number; lastSeenAt: number; lastCpuAboveAt?: number }
>();

function isCodexProcess(cmd: string | undefined, name: string | undefined, matchRe?: RegExp): boolean {
  if (!cmd && !name) return false;
  if (matchRe) {
    return matchRe.test(cmd || "") || matchRe.test(name || "");
  }
  const cmdLine = cmd || "";
  if (cmdLine.includes("/codex/vendor/")) return false;
  if (name === "codex") return true;
  if (cmdLine === "codex" || cmdLine.startsWith("codex ")) return true;
  if (cmdLine.includes("/codex") || cmdLine.includes(" codex ")) return true;
  return false;
}

function isOpenCodeProcess(cmd: string | undefined, name: string | undefined): boolean {
  if (!cmd && !name) return false;
  if (name === "opencode") return true;
  if (!cmd) return false;
  const firstToken = cmd.trim().split(/\s+/)[0];
  const base = path.basename(firstToken);
  if (base === "opencode") return true;
  return false;
}

function isClaudeProcess(cmd: string | undefined, name: string | undefined): boolean {
  if (!cmd && !name) return false;
  if (name === "claude") return true;
  if (!cmd) return false;
  const firstToken = cmd.trim().split(/\s+/)[0];
  const base = path.basename(firstToken);
  if (base === "claude" || base === "claude.exe") return true;
  return false;
}

function inferKind(cmd: string): AgentKind {
  if (cmd.includes(" app-server")) return "app-server";
  if (cmd.includes(" exec")) return "exec";
  if (cmd.includes(" codex") || cmd.startsWith("codex") || cmd.includes("/codex")) return "tui";
  if (cmd.includes(" opencode") || cmd.startsWith("opencode") || cmd.includes("/opencode")) {
    if (cmd.includes(" serve") || cmd.includes("--serve") || cmd.includes(" web")) {
      return "opencode-server";
    }
    if (cmd.includes(" run")) return "opencode-cli";
    return "opencode-tui";
  }
  const claudeInfo = summarizeClaudeCommand(cmd);
  if (claudeInfo) return claudeInfo.kind;
  return "unknown";
}

function shortenCmd(cmd: string, max = 120): string {
  const clean = cmd.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

function parseDoingFromCmd(cmd: string): string | undefined {
  const parts = cmd.split(/\s+/g);
  const claudeInfo = summarizeClaudeCommand(cmd);
  if (claudeInfo?.doing) return claudeInfo.doing;
  const openIndex = parts.findIndex(
    (part) => part === "opencode" || part.endsWith("/opencode")
  );
  if (openIndex !== -1) {
    const mode = parts[openIndex + 1];
    if (mode === "serve" || mode === "web") return `opencode ${mode}`;
    if (mode === "run") {
      for (let i = openIndex + 2; i < parts.length; i += 1) {
        const part = parts[i];
        if (!part || part.startsWith("-")) continue;
        return `opencode run: ${part}`;
      }
      return "opencode run";
    }
    return "opencode";
  }
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

function extractSessionId(cmd: string): string | undefined {
  const parts = cmd.split(/\s+/g);
  const resumeIndex = parts.indexOf("resume");
  if (resumeIndex !== -1) {
    const token = parts[resumeIndex + 1];
    if (token && /^[0-9a-fA-F-]{16,}$/.test(token)) return token;
  }
  const sessionFlag = parts.findIndex((part) => part === "--session" || part === "--session-id");
  if (sessionFlag !== -1) {
    const token = parts[sessionFlag + 1];
    if (token && /^[0-9a-fA-F-]{16,}$/.test(token)) return token;
  }
  return undefined;
}

function extractOpenCodeSessionId(cmd: string): string | undefined {
  const parts = cmd.split(/\s+/g);
  const sessionFlag = parts.findIndex(
    (part) => part === "--session" || part === "--session-id" || part === "-s"
  );
  if (sessionFlag !== -1) {
    const token = parts[sessionFlag + 1];
    if (token) return token;
  }
  return undefined;
}

function normalizeTitle(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/^prompt:\s*/i, "").trim();
}

function parseTimestamp(value?: string | number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 100_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function deriveTitle(
  doing: string | undefined,
  repo: string | undefined,
  pid: number,
  kind: AgentKind
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
  const prefix = kind.startsWith("opencode")
    ? "opencode"
    : kind.startsWith("claude")
      ? "claude"
      : "codex";
  return `${prefix}#${pid}`;
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
    if (result.size > 0) {
      return result;
    }
  } catch {
    // fall through to lsof
  }
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-a",
      "-p",
      pids.join(","),
      "-d",
      "cwd",
      "-Fn",
    ]);
    let currentPid: number | null = null;
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("p")) {
        const pid = Number(line.slice(1));
        currentPid = Number.isNaN(pid) ? null : pid;
      } else if (line.startsWith("n") && currentPid) {
        const cwd = line.slice(1).trim();
        if (cwd) result.set(currentPid, cwd);
      }
    }
  } catch {
    return result;
  }
  return result;
}

async function getStartTimesForPids(pids: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (pids.length === 0) return result;
  if (process.platform === "win32") return result;
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")]);
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const dateStr = match[2].trim();
      const parsed = Date.parse(dateStr);
      if (!Number.isNaN(parsed)) {
        result.set(pid, parsed);
      }
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
  const now = Date.now();
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
  const codexPidSet = new Set(codexProcs.map((proc) => proc.pid));
  const opencodeProcs = processes
    .filter((proc) => isOpenCodeProcess(proc.cmd, proc.name))
    .filter((proc) => !codexPidSet.has(proc.pid));
  const opencodePidSet = new Set(opencodeProcs.map((proc) => proc.pid));
  const claudeProcs = processes
    .filter((proc) => isClaudeProcess(proc.cmd, proc.name))
    .filter((proc) => !codexPidSet.has(proc.pid) && !opencodePidSet.has(proc.pid));
  const pids = Array.from(
    new Set([...codexProcs, ...opencodeProcs, ...claudeProcs].map((proc) => proc.pid))
  );
  let usage: Record<number, pidusage.Status> = {};
  try {
    usage = (await pidusage(pids)) as Record<number, pidusage.Status>;
  } catch {
    usage = {};
  }

  const cwds = await getCwdsForPids(pids);
  const startTimes = await getStartTimesForPids(pids);
  const codexHome = resolveCodexHome();
  const sessions = await listRecentSessions(codexHome);
  const opencodeHost = process.env.CONSENSUS_OPENCODE_HOST || "127.0.0.1";
  const opencodePort = Number(process.env.CONSENSUS_OPENCODE_PORT || 4096);
  const opencodeResult = await getOpenCodeSessions(opencodeHost, opencodePort, {
    silent: true,
    timeoutMs: Number(process.env.CONSENSUS_OPENCODE_TIMEOUT_MS || 1000),
  });
  await ensureOpenCodeServer(opencodeHost, opencodePort, opencodeResult);
  if (opencodeProcs.length) {
    ensureOpenCodeEventStream(opencodeHost, opencodePort);
  }
  const opencodeSessions = opencodeResult.ok ? opencodeResult.sessions : [];
  const opencodeApiAvailable = opencodeResult.ok;
  const opencodeSessionsByPid = new Map<number, (typeof opencodeSessions)[number]>();
  const opencodeSessionsByDir = new Map<string, (typeof opencodeSessions)[number]>();
  for (const session of opencodeSessions) {
    const pid = coerceNumber(session.pid);
    if (typeof pid === "number") {
      opencodeSessionsByPid.set(pid, session);
    }
    if (typeof session.directory === "string") {
      opencodeSessionsByDir.set(session.directory, session);
    }
    if (typeof session.cwd === "string") {
      opencodeSessionsByDir.set(session.cwd, session);
    }
  }

  const agents: AgentSnapshot[] = [];
  const seenIds = new Set<string>();
  const codexEventWindowMs = Number(
    process.env.CONSENSUS_CODEX_EVENT_ACTIVE_MS || 60000
  );
  const codexHoldMs = Number(
    process.env.CONSENSUS_CODEX_ACTIVE_HOLD_MS || 90000
  );
  for (const proc of codexProcs) {
    const stats = usage[proc.pid] || ({} as pidusage.Status);
    const cpu = typeof stats.cpu === "number" ? stats.cpu : 0;
    const mem = typeof stats.memory === "number" ? stats.memory : 0;

    const elapsed = (stats as pidusage.Status & { elapsed?: number }).elapsed;
    const startMs =
      typeof elapsed === "number"
        ? Date.now() - elapsed
        : startTimes.get(proc.pid);

    const cmdRaw = proc.cmd || proc.name || "";
    const sessionId = extractSessionId(cmdRaw);
    const session =
      (sessionId && sessions.find((item) => item.path.includes(sessionId))) ||
      (sessionId ? await findSessionById(codexHome, sessionId) : undefined) ||
      pickSessionForProcess(sessions, startMs);
    let doing: string | undefined;
    let events: AgentSnapshot["events"];
    let model: string | undefined;
    let hasError = false;
    let title: string | undefined;
    let summary: WorkSummary | undefined;
    let lastEventAt: number | undefined;
    let lastActivityAt: number | undefined;
    let inFlight = false;

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
        lastActivityAt = tailSummary.lastActivityAt;
        inFlight = !!tailSummary.inFlight;
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

    const id = `${proc.pid}`;
    const cached = activityCache.get(id);
    const activity = deriveStateWithHold({
      cpu,
      hasError,
      lastEventAt: lastActivityAt,
      inFlight,
      previousActiveAt: cached?.lastActiveAt,
      now,
      eventWindowMs: codexEventWindowMs,
      holdMs: codexHoldMs,
    });
    const state = activity.state;
    activityCache.set(id, {
      lastActiveAt: activity.lastActiveAt,
      lastSeenAt: now,
      lastCpuAboveAt: cached?.lastCpuAboveAt,
    });
    seenIds.add(id);
    const cmd = redactText(cmdRaw) || cmdRaw;
    const cmdShort = shortenCmd(cmd);
    const kind = inferKind(cmd);
    const startedAt = startMs ? Math.floor(startMs / 1000) : undefined;

    const computedTitle = title || deriveTitle(doing, repoName, proc.pid, kind);
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

  const opencodeEventWindowMs = Number(
    process.env.CONSENSUS_OPENCODE_EVENT_ACTIVE_MS || 90_000
  );
  const opencodeHoldMs = Number(
    process.env.CONSENSUS_OPENCODE_ACTIVE_HOLD_MS || 120_000
  );
  const cpuThreshold = Number(process.env.CONSENSUS_CPU_ACTIVE || 1);
  for (const proc of opencodeProcs) {
    const stats = usage[proc.pid] || ({} as pidusage.Status);
    const cpu = typeof stats.cpu === "number" ? stats.cpu : 0;
    const mem = typeof stats.memory === "number" ? stats.memory : 0;

    const elapsed = (stats as pidusage.Status & { elapsed?: number }).elapsed;
    const startMs =
      typeof elapsed === "number"
        ? Date.now() - elapsed
        : startTimes.get(proc.pid);

    const cmdRaw = proc.cmd || proc.name || "";
    const sessionByPid = opencodeSessionsByPid.get(proc.pid);
    const cwdMatch = cwds.get(proc.pid);
    const sessionByDir = sessionByPid
      ? undefined
      : opencodeSessionsByDir.get(cwdMatch || "");
    const session = sessionByPid || sessionByDir;
    const storageSession =
      !session && cwdMatch ? await getOpenCodeSessionForDirectory(cwdMatch) : undefined;
    const sessionId =
      session?.id || storageSession?.id || extractOpenCodeSessionId(cmdRaw);
    const sessionTitle = normalizeTitle(
      session?.title || session?.name || storageSession?.title
    );
    const sessionCwd = session?.cwd || session?.directory || storageSession?.directory;
    const cwdRaw = sessionCwd || cwds.get(proc.pid);
    const cwd = redactText(cwdRaw) || cwdRaw;
    const repoRoot = cwdRaw ? findRepoRoot(cwdRaw) : null;
    const repoName = repoRoot ? path.basename(repoRoot) : undefined;

    const lastActivityAt = parseTimestamp(
      session?.lastActivity ||
        session?.lastActivityAt ||
        storageSession?.time?.updated ||
        storageSession?.time?.created ||
        session?.time?.updated ||
        session?.time?.created ||
        session?.updatedAt ||
        session?.updated ||
        session?.createdAt ||
        session?.created
    );
    const statusRaw = typeof session?.status === "string" ? session.status : undefined;
    const status = statusRaw?.toLowerCase();
    const statusIsError = !!status && /error|failed|failure/.test(status);
    const statusIsIdle = !!status && /idle|stopped|paused/.test(status);
    let hasError = statusIsError;
    const model = typeof session?.model === "string" ? session.model : undefined;

    let doing: string | undefined = sessionTitle;
    let summary: WorkSummary | undefined;
    let events: AgentSnapshot["events"];
    const eventActivity =
      getOpenCodeActivityBySession(sessionId) || getOpenCodeActivityByPid(proc.pid);
    let lastEventAt: number | undefined = eventActivity?.lastEventAt;
    let inFlight = eventActivity?.inFlight;
    if (eventActivity) {
      events = eventActivity.events;
      summary = eventActivity.summary || summary;
      lastEventAt = eventActivity.lastEventAt || lastEventAt;
      if (eventActivity.hasError) hasError = true;
      if (eventActivity.inFlight) inFlight = true;
      if (eventActivity.summary?.current) doing = eventActivity.summary.current;
    }
    if (!lastEventAt && statusIsIdle) {
      lastEventAt = undefined;
    }
    if (!doing) {
      doing =
        parseDoingFromCmd(proc.cmd || "") || shortenCmd(proc.cmd || proc.name || "");
    }
    if (doing) summary = { current: doing };

    const id = `${proc.pid}`;
    const cached = activityCache.get(id);
    const kind = inferKind(cmdRaw);
    const activity = deriveOpenCodeState({
      cpu,
      hasError,
      lastEventAt: lastEventAt,
      inFlight,
      status,
      isServer: kind === "opencode-server",
      previousActiveAt: cached?.lastActiveAt,
      now,
      cpuThreshold,
      eventWindowMs: opencodeEventWindowMs,
      holdMs: opencodeHoldMs,
    });
    let state = activity.state;
    const hasSignal =
      statusIsIdle ||
      statusIsError ||
      typeof lastEventAt === "number" ||
      typeof inFlight === "boolean";
    if (!opencodeApiAvailable && !hasSignal) state = "idle";
    if (!hasSignal && cpu <= cpuThreshold) {
      state = "idle";
    }
    activityCache.set(id, {
      lastActiveAt: activity.lastActiveAt,
      lastSeenAt: now,
      lastCpuAboveAt: cached?.lastCpuAboveAt,
    });
    seenIds.add(id);

    const cmd = redactText(cmdRaw) || cmdRaw;
    const cmdShort = shortenCmd(cmd);
    const startedAt = startMs ? Math.floor(startMs / 1000) : undefined;
    const computedTitle = sessionTitle || deriveTitle(doing, repoName, proc.pid, kind);
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
      repo: repoName,
      cwd,
      model,
      summary: safeSummary,
      events,
    });
  }

  for (const proc of claudeProcs) {
    const stats = usage[proc.pid] || ({} as pidusage.Status);
    const cpu = typeof stats.cpu === "number" ? stats.cpu : 0;
    const mem = typeof stats.memory === "number" ? stats.memory : 0;

    const elapsed = (stats as pidusage.Status & { elapsed?: number }).elapsed;
    const startMs =
      typeof elapsed === "number"
        ? Date.now() - elapsed
        : startTimes.get(proc.pid);

    const cmdRaw = proc.cmd || proc.name || "";
    const claudeInfo = summarizeClaudeCommand(cmdRaw);
    const doing =
      claudeInfo?.doing ||
      parseDoingFromCmd(cmdRaw) ||
      shortenCmd(cmdRaw || proc.name || "");
    const summary = doing ? { current: doing } : undefined;
    const model = claudeInfo?.model;
    const cwdRaw = cwds.get(proc.pid);
    const cwd = redactText(cwdRaw) || cwdRaw;
    const repoRoot = cwdRaw ? findRepoRoot(cwdRaw) : null;
    const repoName = repoRoot ? path.basename(repoRoot) : undefined;
    const kind = claudeInfo?.kind || inferKind(cmdRaw);

    const id = `${proc.pid}`;
    const cached = activityCache.get(id);
    const claudeBaseThreshold = Number(
      process.env.CONSENSUS_CLAUDE_CPU_ACTIVE || process.env.CONSENSUS_CPU_ACTIVE || 1
    );
    const claudeThreshold = getClaudeCpuThreshold(claudeInfo, claudeBaseThreshold);
    const cpuAbove = cpu > claudeThreshold;
    const cpuActiveMs = cpuAbove && cached?.lastCpuAboveAt ? now - cached.lastCpuAboveAt : 0;
    const lastCpuAboveAt = cpuAbove ? cached?.lastCpuAboveAt ?? now : undefined;
    const activity = deriveClaudeState({
      cpu,
      info: claudeInfo,
      previousActiveAt: cached?.lastActiveAt,
      now,
      cpuThreshold: claudeBaseThreshold,
      cpuActiveMs,
    });
    const state = activity.state;
    activityCache.set(id, {
      lastActiveAt: state === "active" ? activity.lastActiveAt : undefined,
      lastSeenAt: now,
      lastCpuAboveAt,
    });
    seenIds.add(id);

    const cmd = redactText(cmdRaw) || cmdRaw;
    const cmdShort = shortenCmd(cmd);
    const startedAt = startMs ? Math.floor(startMs / 1000) : undefined;
    const computedTitle = deriveTitle(doing, repoName, proc.pid, kind);
    const safeSummary = sanitizeSummary(summary);

    agents.push({
      id,
      pid: proc.pid,
      startedAt,
      title: redactText(computedTitle) || computedTitle,
      cmd,
      cmdShort,
      kind,
      cpu,
      mem,
      state,
      doing: redactText(doing) || doing,
      repo: repoName,
      cwd,
      model,
      summary: safeSummary,
    });
  }

  for (const id of activityCache.keys()) {
    if (!seenIds.has(id)) {
      activityCache.delete(id);
    }
  }

  return { ts: now, agents };
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
