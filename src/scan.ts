import psList from "ps-list";
import pidusage from "pidusage";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { performance } from "perf_hooks";
import { Effect } from "effect";
import type {
  AgentKind,
  AgentSnapshot,
  AgentState,
  SnapshotPayload,
  WorkSummary,
} from "./types.js";
import { deriveCodexEventState } from "./codexState.js";
import {
  listRecentSessions,
  findSessionById,
  findSessionByCwd,
  pickSessionForProcess,
  resolveCodexHome,
  summarizeTail,
  updateTail,
  getTailState,
  getSessionMeta,
  getSessionStartMsFromPath,
} from "./codexLogs.js";
import { codexEventStore } from "./services/codexEvents.js";
import type { SessionFile } from "./codexLogs.js";

import { getOpenCodeSessions, getOpenCodeSessionActivity, type OpenCodeSessionResult } from "./opencodeApi.js";
import { ensureOpenCodeServer } from "./opencodeServer.js";
import {
  ensureOpenCodeEventStream,
  getOpenCodeActivityByPid,
  getOpenCodeActivityBySession,
} from "./opencodeEvents.js";
import {
  getOpenCodeSessionId,
  getOpenCodeSessionPid,
  markOpenCodeSessionUsed,
  selectOpenCodeSessionForTui,
} from "./opencodeSessionAssign.js";
import { getOpenCodeSessionForDirectory } from "./opencodeStorage.js";
import { deriveOpenCodeState } from "./opencodeState.js";
import { shouldUseOpenCodeApiActivityAt } from "./opencodeApiActivity.js";
import { shouldIncludeOpenCodeProcess } from "./opencodeFilter.js";
import { summarizeClaudeCommand } from "./claudeCli.js";
import { deriveStateWithHold } from "./activity.js";
import { getClaudeActivityByCwd, getClaudeActivityBySession } from "./services/claudeEvents.js";
import { parseOpenCodeCommand, summarizeOpenCodeCommand } from "./opencodeCmd.js";
import { redactText } from "./redact.js";
import { dedupeAgents } from "./dedupe.js";
import {
  recordActivityCount,
  recordActivityTransition,
  runPromise,
} from "./observability/index.js";

const dirtySessionPaths = new Set<string>();
const execFileAsync = promisify(execFile);
const fsp = fs.promises;
const repoCache = new Map<string, string | null>();
const activityCache = new Map<
  string,
  {
    lastActiveAt?: number;
    lastSeenAt: number;
    lastCpuAboveAt?: number;
    lastState?: AgentState;
    lastReason?: string;
    startMs?: number;
    sessionId?: string;
  }
>();
let opencodeSessionCache: OpenCodeSessionResult | null = null;
let opencodeSessionCacheAt = 0;
const pidSessionCache = new Map<
  number,
  { path: string; lastSeenAt: number; startMs?: number }
>();
const opencodeServerLogged = new Set<number>();
const opencodeSessionByPidCache = new Map<
  number,
  { sessionId: string; lastSeenAt: number }
>();
const START_MS_EPSILON_MS = 1000;

const isDebugActivity = () => process.env.CONSENSUS_DEBUG_ACTIVITY === "1";

function logActivityDecision(message: string): void {
  if (!isDebugActivity()) return;
  process.stderr.write(`[consensus][activity] ${message}\n`);
}

function isStartMsMismatch(cached?: number, current?: number): boolean {
  if (typeof cached !== "number" || typeof current !== "number") return false;
  return Math.abs(cached - current) > START_MS_EPSILON_MS;
}

function providerForKind(kind: AgentKind): string {
  if (kind.startsWith("opencode")) return "opencode";
  if (kind.startsWith("claude")) return "claude";
  if (kind === "app-server") return "server";
  if (kind === "unknown") return "other";
  return "codex";
}

const profileEnabled =
  process.env.CONSENSUS_PROFILE === "1" || process.env.CONSENSUS_PROFILE === "true";
const profileThresholdMs = Math.max(0, Number(process.env.CONSENSUS_PROFILE_MS || 25));

type ProfileHandle = { label: string; start: number; extra?: string };

function startProfile(label: string, extra?: string): ProfileHandle | null {
  if (!profileEnabled) return null;
  return { label, start: performance.now(), extra };
}

function endProfile(
  handle: ProfileHandle | null,
  data?: Record<string, number | string | undefined>
): void {
  if (!handle) return;
  const duration = performance.now() - handle.start;
  if (duration < profileThresholdMs) return;
  const parts = data
    ? Object.entries(data)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`)
    : [];
  const suffix = parts.length ? ` ${parts.join(" ")}` : "";
  const label = handle.extra ? `${handle.label} ${handle.extra}` : handle.label;
  process.stdout.write(`[consensus] scan:${label} ${duration.toFixed(1)}ms${suffix}\n`);
}

export function markSessionDirty(sessionPath: string): void {
  if (!sessionPath) return;
  dirtySessionPaths.add(sessionPath);
}

function consumeDirtySessions(): Set<string> {
  const dirty = new Set(dirtySessionPaths);
  dirtySessionPaths.clear();
  return dirty;
}

type ScanMode = "fast" | "full";
export interface ScanOptions {
  mode?: ScanMode;
  includeActivity?: boolean;
}

type PsProcess = Awaited<ReturnType<typeof psList>>[number];
const processCache: {
  at: number;
  processes: PsProcess[];
  usage: Record<number, pidusage.Status>;
  cwds: Map<number, string>;
  startTimes: Map<number, number>;
  jsonlByPid: Map<number, string[]>;
} = {
  at: 0,
  processes: [],
  usage: {},
  cwds: new Map(),
  startTimes: new Map(),
  jsonlByPid: new Map(),
};

const sessionCache: {
  at: number;
  home: string;
  sessions: Awaited<ReturnType<typeof listRecentSessions>>;
} = {
  at: 0,
  home: "",
  sessions: [],
};

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function isCodexBinary(value: string | undefined): boolean {
  if (!value) return false;
  const cleaned = stripQuotes(value);
  const base = path.basename(cleaned).toLowerCase();
  return base === "codex" || base === "codex.exe";
}

function hasCodexVendorPath(cmdLine: string): boolean {
  return /[\\/]+codex[\\/]+vendor[\\/]+/i.test(cmdLine);
}

function hasCodexToken(cmdLine: string): boolean {
  return (
    /(?:^|\s|[\\/])codex(\.exe)?(?:\s|$)/i.test(cmdLine) ||
    /[\\/]+codex(\.exe)?/i.test(cmdLine)
  );
}

function isCodexProcess(cmd: string | undefined, name: string | undefined, matchRe?: RegExp): boolean {
  if (!cmd && !name) return false;
  if (isOpenCodeProcess(cmd, name)) return false;
  if (isClaudeProcess(cmd, name)) return false;
  const cmdLine = cmd || "";
  if (hasCodexVendorPath(cmdLine)) return false;
  if (matchRe) {
    return matchRe.test(cmdLine) || matchRe.test(name || "");
  }
  if (isCodexBinary(name)) return true;
  if (cmdLine && isCodexBinary(cmdLine.split(/\s+/g)[0])) return true;
  if (hasCodexToken(cmdLine)) return true;
  return false;
}

function isCodexVendorProcess(cmd: string | undefined, name: string | undefined): boolean {
  if (!cmd && !name) return false;
  const cmdLine = cmd || "";
  if (!hasCodexVendorPath(cmdLine)) return false;
  if (isCodexBinary(name)) return true;
  if (hasCodexToken(cmdLine)) return true;
  return false;
}

function isOpenCodeProcess(cmd: string | undefined, name: string | undefined): boolean {
  if (!cmd && !name) return false;
  if (name && name.toLowerCase() === "opencode") return true;
  if (!cmd) return false;
  const firstToken = cmd.trim().split(/\s+/)[0];
  const base = path.basename(firstToken).toLowerCase();
  if (base === "opencode" || base === "opencode.exe") return true;
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
  const openInfo = parseOpenCodeCommand(cmd);
  if (openInfo) return openInfo.kind;
  const claudeInfo = summarizeClaudeCommand(cmd);
  if (claudeInfo) return claudeInfo.kind;
  if (cmd.includes(" exec")) return "exec";
  if (
    cmd.includes(" codex") ||
    cmd.startsWith("codex") ||
    cmd.startsWith("codex.exe") ||
    /[\\/]+codex(\.exe)?/i.test(cmd)
  ) {
    return "tui";
  }
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
  const openInfo = summarizeOpenCodeCommand(cmd);
  if (openInfo?.doing) return openInfo.doing;
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
  if (cmd.startsWith("codex") || cmd.startsWith("codex.exe")) return "codex";
  return undefined;
}

function extractSessionId(cmd: string): string | undefined {
  const parts = cmd.split(/\s+/g);
  const resumeIndex = parts.indexOf("resume");
  if (resumeIndex !== -1) {
    const token = parts[resumeIndex + 1];
    if (token) {
      const cleaned = stripQuotes(token);
      if (/^[0-9a-fA-F-]{16,}$/.test(cleaned)) return cleaned;
    }
  }
  const sessionFlag = parts.findIndex((part) => part === "--session" || part === "--session-id");
  if (sessionFlag !== -1) {
    const token = parts[sessionFlag + 1];
    if (token) {
      const cleaned = stripQuotes(token);
      if (/^[0-9a-fA-F-]{16,}$/.test(cleaned)) return cleaned;
    }
  }
  for (const part of parts) {
    if (part.startsWith("--session-id=") || part.startsWith("--session=")) {
      const token = part.split("=", 2)[1];
      if (token) {
        const cleaned = stripQuotes(token);
        if (/^[0-9a-fA-F-]{16,}$/.test(cleaned)) return cleaned;
      }
    }
  }
  return undefined;
}

function splitCmdArgs(command: string): string[] {
  if (!command) return [];
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!matches) return [];
  return matches.map((part) => part.replace(/^"(.*)"$/, "$1"));
}

function extractCwdFromCmd(cmd: string): string | undefined {
  const parts = splitCmdArgs(cmd);
  if (parts.length === 0) return undefined;
  const flags = new Set(["--cwd", "--working-dir", "--workdir", "--dir"]);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (flags.has(part)) {
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) return next;
    }
    for (const flag of flags) {
      if (part.startsWith(`${flag}=`)) {
        const value = part.slice(flag.length + 1);
        if (value) return value;
      }
    }
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
    if (token) return stripQuotes(token);
  }
  for (const part of parts) {
    if (part.startsWith("--session-id=") || part.startsWith("--session=")) {
      const token = part.split("=", 2)[1];
      if (token) return stripQuotes(token);
    }
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
  if (process.platform === "darwin") {
    return await getCwdsForPidsWithLsof(pids);
  }
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
  return await getCwdsForPidsWithLsof(pids);
}

async function getCwdsForPidsWithLsof(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
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

async function getJsonlForPids(pids: number[]): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();
  if (pids.length === 0) return result;
  if (process.platform === "win32") return result;
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-a",
      "-p",
      pids.join(","),
      "-Fn",
    ]);
    let currentPid: number | null = null;
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("p")) {
        const pid = Number(line.slice(1));
        currentPid = Number.isNaN(pid) ? null : pid;
        continue;
      }
      if (!currentPid) continue;
      if (!line.startsWith("n")) continue;
      const filePath = line.slice(1).trim();
      if (!filePath.endsWith(".jsonl")) continue;
      const list = result.get(currentPid) || [];
      list.push(filePath);
      result.set(currentPid, list);
    }
  } catch {
    return result;
  }
  return result;
}

async function buildJsonlMtimeIndex(paths: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const filePath of paths) {
    if (result.has(filePath)) continue;
    try {
      const stat = await fsp.stat(filePath);
      result.set(filePath, stat.mtimeMs);
    } catch {
      // ignore missing paths
    }
  }
  return result;
}

function pickNewestJsonl(
  paths: string[],
  mtimes: Map<string, number>
): string | undefined {
  let best: string | undefined;
  let bestMtime = -1;
  for (const filePath of paths) {
    const mtime = mtimes.get(filePath);
    if (mtime === undefined) continue;
    if (!best || mtime > bestMtime) {
      best = filePath;
      bestMtime = mtime;
    }
  }
  return best;
}

async function getStartTimesForPidsWindows(pids: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (pids.length === 0) return result;
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  if (!filter) return result;
  const command = [
    "Get-CimInstance Win32_Process -Filter",
    `'${filter}'`,
    "| Select-Object ProcessId,",
    "@{Name='StartMs';Expression={[int64](([System.Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate).ToUniversalTime() - [DateTime]::Parse('1970-01-01T00:00:00Z')).TotalMilliseconds)}}",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const run = async (shell: string): Promise<string> => {
    const { stdout } = await execFileAsync(shell, ["-NoProfile", "-Command", command]);
    return stdout;
  };
  let stdout = "";
  try {
    stdout = await run("powershell");
  } catch {
    try {
      stdout = await run("pwsh");
    } catch {
      return result;
    }
  }
  const trimmed = stdout.trim();
  if (!trimmed) return result;
  try {
    const parsed = JSON.parse(trimmed) as
      | { ProcessId?: number | string; StartMs?: number | string }
      | Array<{ ProcessId?: number | string; StartMs?: number | string }>;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const pid = Number(entry.ProcessId);
      const startMs = Number(entry.StartMs);
      if (Number.isFinite(pid) && Number.isFinite(startMs)) {
        result.set(pid, startMs);
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
  if (process.platform === "win32") return await getStartTimesForPidsWindows(pids);
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

async function getPidUsageForPids(
  pids: number[]
): Promise<Record<number, pidusage.Status>> {
  if (pids.length === 0) return {};
  const fallback = async (): Promise<Record<number, pidusage.Status>> => {
    const result: Record<number, pidusage.Status> = {};
    for (const pid of pids) {
      try {
        const stat = await pidusage(pid);
        if (stat && typeof stat.cpu === "number") {
          result[pid] = stat;
        }
      } catch {
        // ignore missing pids
      }
    }
    return result;
  };
  try {
    const bulk = await pidusage(pids);
    if (bulk && Object.keys(bulk).length > 0) return bulk;
  } catch {
    // fall back to per-pid sampling
  }
  return await fallback();
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

export async function scanCodexProcesses(options: ScanOptions = {}): Promise<SnapshotPayload> {
  const now = Date.now();
  const mode: ScanMode = options.mode ?? "full";
  const includeActivity = options.includeActivity !== false;
  const scanTimer = startProfile("total", mode);
  const dirtySessions = includeActivity && mode === "fast" ? consumeDirtySessions() : null;
  const metricEffects: Effect.Effect<void, never, never>[] = [];
  const activityTransitions = new Map<
    string,
    { total: number; byReason: Record<string, number>; byState: Record<string, number> }
  >();
  const trackTransition = (
    provider: string,
    from: AgentState,
    to: AgentState,
    reason: string
  ): void => {
    const current =
      activityTransitions.get(provider) || { total: 0, byReason: {}, byState: {} };
    current.total += 1;
    current.byReason[reason] = (current.byReason[reason] ?? 0) + 1;
    const stateKey = `${from}->${to}`;
    current.byState[stateKey] = (current.byState[stateKey] ?? 0) + 1;
    activityTransitions.set(provider, current);
  };
  const matchEnv = process.env.CONSENSUS_PROCESS_MATCH;
  const debugOpencode = process.env.CONSENSUS_DEBUG_OPENCODE === "1";
  const logOpencode = (msg: string) => {
    if (debugOpencode) process.stderr.write(`[consensus][opencode] ${msg}\n`);
  };
  let matchRe: RegExp | undefined;
  if (matchEnv) {
    try {
      matchRe = new RegExp(matchEnv);
    } catch {
      matchRe = undefined;
    }
  }
  const pollMs = Math.max(250, Number(process.env.CONSENSUS_POLL_MS || 500));
  const resolveMs = (value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  let nextTickAt: number | null = null;
  const bumpNextTickAt = (candidate: number | undefined): void => {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) return;
    if (candidate <= now) {
      nextTickAt = now;
      return;
    }
    if (nextTickAt === null || candidate < nextTickAt) {
      nextTickAt = candidate;
    }
  };
  const processCacheMs = Math.max(100, resolveMs(process.env.CONSENSUS_PROCESS_CACHE_MS, 1000));
  const processCacheFastMs = Math.max(
    100,
    resolveMs(process.env.CONSENSUS_PROCESS_CACHE_FAST_MS, 500)
  );
  const processCacheTtl = mode === "fast" ? processCacheFastMs : processCacheMs;
  const sessionCacheMs = Math.max(100, resolveMs(process.env.CONSENSUS_SESSION_CACHE_MS, 1000));
  const sessionCacheFastMs = Math.max(
    100,
    resolveMs(process.env.CONSENSUS_SESSION_CACHE_FAST_MS, 500)
  );
  const sessionsCacheTtl = mode === "fast" ? sessionCacheFastMs : sessionCacheMs;
  const shouldUseProcessCache =
    mode === "fast" &&
    now - processCache.at < processCacheTtl &&
    processCache.processes.length > 0;

  let processes: PsProcess[] = [];
  let usage: Record<number, pidusage.Status> = {};
  let cwds = new Map<number, string>();
  let startTimes = new Map<number, number>();
  let jsonlByPid = new Map<number, string[]>();

  if (shouldUseProcessCache) {
    processes = processCache.processes;
    usage = processCache.usage;
    cwds = processCache.cwds;
    startTimes = processCache.startTimes;
    jsonlByPid = processCache.jsonlByPid || new Map();
  } else {
    const psTimer = startProfile("psList");
    processes = await psList();
    endProfile(psTimer, { count: processes.length });
  }
  const codexWrapperProcs = processes.filter((proc) =>
    isCodexProcess(proc.cmd, proc.name, matchRe)
  );
  const codexWrapperPidSet = new Set(codexWrapperProcs.map((proc) => proc.pid));
  const codexVendorCandidates = processes.filter((proc) =>
    isCodexVendorProcess(proc.cmd, proc.name)
  );
  const codexVendorChildren = codexVendorCandidates.filter((proc) =>
    codexWrapperPidSet.has(proc.ppid ?? -1)
  );
  const codexVendorProcs = codexVendorCandidates.filter(
    (proc) => !codexWrapperPidSet.has(proc.ppid ?? -1)
  );
  const includeVendor =
    process.env.CONSENSUS_INCLUDE_CODEX_VENDOR === "1" ||
    process.env.CONSENSUS_INCLUDE_CODEX_VENDOR === "true";
  const codexProcs = includeVendor ? [...codexWrapperProcs, ...codexVendorProcs] : codexWrapperProcs;
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
  const codexVendorPids = codexVendorChildren.map((proc) => proc.pid);
  const usagePids = Array.from(new Set([...pids, ...codexVendorPids]));
  if (shouldUseProcessCache) {
    const refreshPids = new Set<number>(
      [...opencodeProcs, ...claudeProcs].map((proc) => proc.pid)
    );
    for (const pid of codexVendorPids) refreshPids.add(pid);
    const refreshList = Array.from(refreshPids);
    if (refreshList.length > 0) {
      const refreshTimer = startProfile("pidusage", "fast");
      try {
        const refreshed = await getPidUsageForPids(refreshList);
        usage = { ...usage, ...refreshed };
        processCache.usage = usage;
      } catch {
        // ignore refresh failures
      }
      endProfile(refreshTimer, { count: refreshList.length });
    }
    if (includeActivity && codexWrapperProcs.length > 0) {
      const jsonlCandidates = Array.from(
        new Set([
          ...codexWrapperProcs.map((proc) => proc.pid),
          ...codexVendorChildren.map((proc) => proc.pid),
        ])
      );
      if (jsonlCandidates.length > 0) {
        const jsonlTimer = startProfile("jsonl", "fast");
        try {
          jsonlByPid = await getJsonlForPids(jsonlCandidates);
          processCache.jsonlByPid = jsonlByPid;
        } catch {
          // ignore refresh failures
        }
        endProfile(jsonlTimer, { count: jsonlByPid.size });
      }
    }
  }
  if (!shouldUseProcessCache) {
    const usageTimer = startProfile("pidusage");
    usage = await getPidUsageForPids(usagePids);
    endProfile(usageTimer, { count: usagePids.length });

    const cwdTimer = startProfile("cwd");
    cwds = await getCwdsForPids(pids);
    if (cwds.size < pids.length) {
      for (const proc of processes) {
        if (cwds.has(proc.pid)) continue;
        const inferred = extractCwdFromCmd(proc.cmd || "");
        if (inferred) cwds.set(proc.pid, inferred);
      }
    }
    endProfile(cwdTimer, { count: cwds.size });

    const codexChildren: number[] = [];
    const childrenByPpid = new Map<number, number[]>();
    for (const proc of processes) {
      if (typeof proc.ppid !== "number") continue;
      const list = childrenByPpid.get(proc.ppid) || [];
      list.push(proc.pid);
      childrenByPpid.set(proc.ppid, list);
    }
    for (const proc of codexProcs) {
      const children = childrenByPpid.get(proc.pid);
      if (!children) continue;
      codexChildren.push(...children);
    }
    const jsonlCandidates = Array.from(new Set([...codexProcs.map((p) => p.pid), ...codexChildren]));
    const jsonlTimer = startProfile("jsonl");
    jsonlByPid = await getJsonlForPids(jsonlCandidates);
    endProfile(jsonlTimer, { count: jsonlByPid.size });

    const startTimer = startProfile("startTimes");
    startTimes = await getStartTimesForPids(pids);
    endProfile(startTimer, { count: startTimes.size });

    processCache.at = now;
    processCache.processes = processes;
    processCache.usage = usage;
    processCache.cwds = cwds;
    processCache.startTimes = startTimes;
    processCache.jsonlByPid = jsonlByPid;
  }

  if (codexVendorChildren.length > 0) {
    const vendorCpuByWrapper = new Map<number, number>();
    for (const vendor of codexVendorChildren) {
      const parentPid = vendor.ppid;
      if (typeof parentPid !== "number") continue;
      if (!codexWrapperPidSet.has(parentPid)) continue;
      const cpu = usage[vendor.pid]?.cpu ?? 0;
      if (cpu <= 0) continue;
      vendorCpuByWrapper.set(parentPid, (vendorCpuByWrapper.get(parentPid) || 0) + cpu);
    }
    if (vendorCpuByWrapper.size > 0) {
      for (const [wrapperPid, cpu] of vendorCpuByWrapper.entries()) {
        const existing = usage[wrapperPid];
        if (!existing) continue;
        usage[wrapperPid] = { ...existing, cpu: (existing.cpu ?? 0) + cpu };
      }
      processCache.usage = usage;
    }
  }

  const codexHome = resolveCodexHome();
  const opencodeHost = process.env.CONSENSUS_OPENCODE_HOST || "127.0.0.1";
  const opencodePort = Number(process.env.CONSENSUS_OPENCODE_PORT || 4096);
  const timeoutMs = Number(process.env.CONSENSUS_OPENCODE_TIMEOUT_MS || 1000);
  const opencodePollMs = Math.max(pollMs * 2, 2000);
  const shouldFetchOpenCode =
    !opencodeSessionCache || now - opencodeSessionCacheAt > opencodePollMs;
  const opencodeTimer = shouldFetchOpenCode ? startProfile("opencode") : null;
  const opencodeResultPromise =
    shouldFetchOpenCode
      ? getOpenCodeSessions(opencodeHost, opencodePort, {
          silent: true,
          timeoutMs,
        }).then((result) => {
          opencodeSessionCache = result;
          opencodeSessionCacheAt = now;
          return result;
        })
      : Promise.resolve(opencodeSessionCache);

  const opencodeResultRaw = await opencodeResultPromise;
  endProfile(opencodeTimer, { ok: opencodeResultRaw?.ok ? 1 : 0 });
  const opencodeResult = opencodeResultRaw ?? {
    ok: false,
    sessions: [],
    reachable: false,
  };
  await ensureOpenCodeServer(opencodeHost, opencodePort, opencodeResult, opencodeProcs.length > 0);
  if (opencodeProcs.length > 0 || opencodeResult.ok) {
    ensureOpenCodeEventStream(opencodeHost, opencodePort);
  }
  const opencodeSessions = opencodeResult.ok ? opencodeResult.sessions : [];
  const opencodeApiAvailable = opencodeResult.ok;
  type OpenCodeSession = (typeof opencodeSessions)[number];
  const opencodeSessionsByPid = new Map<number, OpenCodeSession>();
  const opencodeSessionsById = new Map<string, OpenCodeSession>();
  // Track ALL recent sessions per directory for activity polling (not just the latest)
  const opencodeAllSessionsByDir = new Map<string, OpenCodeSession[]>();
  const opencodeSessionTimestamp = (session: OpenCodeSession): number => {
    return (
      parseTimestamp(
        session.lastActivity ||
          session.lastActivityAt ||
          session.time?.updated ||
          session.updatedAt ||
          session.updated ||
          session.time?.created ||
          session.createdAt ||
          session.created
      ) ?? 0
    );
  };
  // Helper to add session to all-sessions-by-dir index
  const addSessionToDir = (dir: string | undefined, session: OpenCodeSession) => {
    if (!dir) return;
    const existing = opencodeAllSessionsByDir.get(dir);
    if (existing) {
      existing.push(session);
      return;
    }
    opencodeAllSessionsByDir.set(dir, [session]);
  };
  for (const session of opencodeSessions) {
    const pid = getOpenCodeSessionPid(session);
    if (typeof pid === "number") {
      opencodeSessionsByPid.set(pid, session);
    }
    const sessionId = getOpenCodeSessionId(session);
    if (sessionId) {
      opencodeSessionsById.set(sessionId, session);
    }
    if (typeof session.directory === "string") {
      addSessionToDir(session.directory, session);
    }
    if (typeof session.cwd === "string") {
      addSessionToDir(session.cwd, session);
    }
  }
  for (const sessions of opencodeAllSessionsByDir.values()) {
    sessions.sort((a, b) => opencodeSessionTimestamp(b) - opencodeSessionTimestamp(a));
  }
  const opencodeTuiByDir = new Map<string, PsProcess[]>();
  for (const proc of opencodeProcs) {
    const cmdRaw = proc.cmd || proc.name || "";
    const kind = inferKind(cmdRaw);
    if (kind !== "opencode-tui") continue;
    const cwdRaw = cwds.get(proc.pid);
    if (!cwdRaw) continue;
    const existing = opencodeTuiByDir.get(cwdRaw);
    if (existing) {
      existing.push(proc);
    } else {
      opencodeTuiByDir.set(cwdRaw, [proc]);
    }
  }
  const opencodeMessageActivityCache = new Map<
    string,
    Awaited<ReturnType<typeof getOpenCodeSessionActivity>>
  >();
  const getCachedOpenCodeSessionActivity = async (sessionId: string) => {
    const cached = opencodeMessageActivityCache.get(sessionId);
    if (cached) return cached;
    const result = await getOpenCodeSessionActivity(
      sessionId,
      opencodeHost,
      opencodePort,
      { silent: true, timeoutMs: 2000 }
    );
    opencodeMessageActivityCache.set(sessionId, result);
    return result;
  };
  const opencodeActiveSessionIdsByDir = new Map<string, string[]>();
  const prefetchActiveSessionsByDir = async () => {
    const tasks: Promise<void>[] = [];
    for (const [dir, sessions] of opencodeAllSessionsByDir.entries()) {
      const tuiCount = opencodeTuiByDir.get(dir)?.length ?? 0;
      if (tuiCount === 0) continue;
      const minCandidates = Math.max(tuiCount, 2);
      tasks.push(
        (async () => {
          const activeIds: string[] = [];
          let checked = 0;
          for (const session of sessions) {
            if (checked >= minCandidates && activeIds.length >= tuiCount) break;
            const id = getOpenCodeSessionId(session);
            if (!id) {
              checked += 1;
              continue;
            }
            const statusActivity = getOpenCodeActivityBySession(id);
            const statusValue = statusActivity?.lastStatus?.toLowerCase();
            if (statusValue) {
              if (statusValue !== "idle") {
                activeIds.push(id);
              }
              checked += 1;
              continue;
            }
            const activity = await getCachedOpenCodeSessionActivity(id);
            if (activity.ok && activity.inFlight) {
              activeIds.push(id);
            }
            checked += 1;
          }
          if (activeIds.length > 0) {
            opencodeActiveSessionIdsByDir.set(dir, activeIds);
          }
        })()
      );
    }
    await Promise.all(tasks);
  };
  await prefetchActiveSessionsByDir();
  const cacheMatchesHome =
    sessionCache.home === codexHome && sessionCache.sessions.length > 0;
  let sessions: SessionFile[] = [];
  if (mode === "fast") {
    const shouldRefreshSessions = !!dirtySessions && dirtySessions.size > 0;
    const shouldUseSessionCache =
      cacheMatchesHome && now - sessionCache.at < sessionsCacheTtl;
    if (shouldUseSessionCache && !shouldRefreshSessions) {
      sessions = sessionCache.sessions;
    } else {
      const sessionsTimer = startProfile("sessions", "fast");
      sessions = await listRecentSessions(codexHome);
      endProfile(sessionsTimer, { count: sessions.length });
      sessionCache.at = now;
      sessionCache.home = codexHome;
      sessionCache.sessions = sessions;
    }
  } else {
    const shouldUseSessionCache =
      cacheMatchesHome && now - sessionCache.at < sessionsCacheTtl;
    if (shouldUseSessionCache) {
      sessions = sessionCache.sessions;
    } else {
      const sessionsTimer = startProfile("sessions", "full");
      sessions = await listRecentSessions(codexHome);
      endProfile(sessionsTimer, { count: sessions.length });
      sessionCache.at = now;
      sessionCache.home = codexHome;
      sessionCache.sessions = sessions;
    }
  }

  const agents: AgentSnapshot[] = [];
  const seenIds = new Set<string>();
  const codexHoldMs = resolveMs(
    process.env.CONSENSUS_CODEX_ACTIVE_HOLD_MS,
    0
  );
  const codexEventIdleMs = resolveMs(
    process.env.CONSENSUS_CODEX_EVENT_IDLE_MS,
    20000
  );

  type CodexContext = {
    proc: PsProcess;
    cpu: number;
    mem: number;
    startMs?: number;
    cmdRaw: string;
    cwdRaw?: string;
    sessionId?: string;
    session?: SessionFile;
    jsonlPaths?: string[];
    reuseBlocked?: boolean;
  };
  const codexContexts: CodexContext[] = [];
  const usedSessionPaths = new Set<string>();
  const normalizeSessionPath = (value?: string): string | undefined =>
    value ? path.resolve(value) : undefined;
  const jsonlPathSet = new Set<string>();

  const jsonlPaths = Array.from(
    new Set(
      Array.from(jsonlByPid.values()).flatMap((paths) => paths)
    )
  );
  for (const jsonlPath of jsonlPaths) {
    const normalized = normalizeSessionPath(jsonlPath);
    if (normalized) jsonlPathSet.add(normalized);
  }
  const jsonlMtimes = await buildJsonlMtimeIndex(jsonlPaths);

  const childJsonlByPid = new Map<number, string[]>();
  if (jsonlByPid.size > 0) {
    const childrenByPpid = new Map<number, number[]>();
    for (const proc of processes) {
      if (typeof proc.ppid !== "number") continue;
      const list = childrenByPpid.get(proc.ppid) || [];
      list.push(proc.pid);
      childrenByPpid.set(proc.ppid, list);
    }
    for (const proc of codexProcs) {
      const childPids = childrenByPpid.get(proc.pid) || [];
      const childPaths = childPids.flatMap((pid) => jsonlByPid.get(pid) || []);
      if (childPaths.length) childJsonlByPid.set(proc.pid, childPaths);
    }
  }

  for (const proc of codexProcs) {
    const stats = usage[proc.pid] || ({} as pidusage.Status);
    const cpu = typeof stats.cpu === "number" ? stats.cpu : 0;
    const mem = typeof stats.memory === "number" ? stats.memory : 0;
    const elapsed = (stats as pidusage.Status & { elapsed?: number }).elapsed;
    const startMs =
      typeof elapsed === "number"
        ? now - elapsed
        : startTimes.get(proc.pid);
    const cmdRaw = proc.cmd || proc.name || "";
    const cwdRaw = cwds.get(proc.pid);
    const sessionId = extractSessionId(cmdRaw);
    let cachedSession: SessionFile | undefined;
    let cachedEntry = pidSessionCache.get(proc.pid);
    if (cachedEntry && isStartMsMismatch(cachedEntry.startMs, startMs)) {
      pidSessionCache.delete(proc.pid);
      cachedEntry = undefined;
    }
    if (cachedEntry) {
      try {
        const stat = await fsp.stat(cachedEntry.path);
        cachedSession = { path: cachedEntry.path, mtimeMs: stat.mtimeMs };
      } catch {
        pidSessionCache.delete(proc.pid);
      }
    }
    const directJsonl = jsonlByPid.get(proc.pid) || [];
    const childJsonl = childJsonlByPid.get(proc.pid) || [];
    const jsonlPaths = Array.from(
      new Set([...directJsonl, ...childJsonl].map(normalizeSessionPath).filter(Boolean))
    ) as string[];
    const mappedJsonl = pickNewestJsonl([...directJsonl, ...childJsonl], jsonlMtimes);
    const startMsForCwd =
      typeof startMs === "number" && now - startMs < 5 * 60_000 ? startMs : undefined;
    const cwdSession = cwdRaw
      ? await findSessionByCwd(sessions, cwdRaw, startMsForCwd, usedSessionPaths)
      : undefined;
    const mappedSession = mappedJsonl
      ? { path: mappedJsonl, mtimeMs: jsonlMtimes.get(mappedJsonl) ?? now }
      : undefined;
    let session = mappedSession;
    session =
      (sessionId && sessions.find((item) => item.path.includes(sessionId))) ||
      (sessionId ? await findSessionById(codexHome, sessionId) : undefined) ||
      session ||
      cwdSession ||
      cachedSession;
    if (cwdSession && mappedSession) {
      const mappedMtime = mappedSession.mtimeMs ?? 0;
      const cwdMtime = cwdSession.mtimeMs ?? 0;
      if (cwdMtime > mappedMtime + 1000) {
        session = cwdSession;
      }
    }
    const hasExplicitSession = !!sessionId || !!mappedJsonl;
    const allowReuse = hasExplicitSession || /\bresume\b/i.test(cmdRaw);
    const initialSessionPath = normalizeSessionPath(session?.path);
    let reuseBlocked = false;
    if (initialSessionPath && usedSessionPaths.has(initialSessionPath) && !allowReuse) {
      const alternate = cwdSession;
      const alternatePath = normalizeSessionPath(alternate?.path);
      if (alternate && alternatePath && alternatePath !== initialSessionPath) {
        session = alternate;
      } else {
        reuseBlocked = true;
      }
    }
    if (!session) {
      session = cwdSession;
      reuseBlocked = false;
    }
    const sessionPath = normalizeSessionPath(session?.path);
    if (sessionPath) {
      usedSessionPaths.add(sessionPath);
    }
    codexContexts.push({
      proc,
      cpu,
      mem,
      startMs,
      cmdRaw,
      cwdRaw,
      sessionId,
      session,
      jsonlPaths,
      reuseBlocked,
    });
  }

  const tailTargets = new Set<string>();
  const cachedTails = new Map<string, Awaited<ReturnType<typeof updateTail>>>();
  const tailOptionsByPath = new Map<string, { keepStale?: boolean }>();
  if (includeActivity) {
    if (dirtySessions) {
      for (const dirtyPath of dirtySessions) {
        const resolved = path.resolve(dirtyPath);
        tailTargets.add(resolved);
        if (!tailOptionsByPath.has(resolved)) {
          tailOptionsByPath.set(resolved, { keepStale: false });
        }
      }
    }
    for (const ctx of codexContexts) {
      const sessionPath = normalizeSessionPath(ctx.session?.path);
      if (!sessionPath) continue;
      tailTargets.add(sessionPath);
      tailOptionsByPath.set(sessionPath, { keepStale: true });
      if (ctx.jsonlPaths?.length) {
        for (const jsonlPath of ctx.jsonlPaths) {
          tailTargets.add(jsonlPath);
          if (!tailOptionsByPath.has(jsonlPath)) {
            tailOptionsByPath.set(jsonlPath, { keepStale: true });
          }
        }
      }
    }
  }
  const tailsTimer = startProfile("tails");
  const tailEntries: Array<[string, Awaited<ReturnType<typeof updateTail>>]> =
    includeActivity
      ? await Promise.all(
          Array.from(tailTargets).map(async (sessionPath) => {
            const tail = await updateTail(sessionPath, tailOptionsByPath.get(sessionPath));
            return [sessionPath, tail] as const;
          })
        )
      : [];
  endProfile(tailsTimer, { updated: tailTargets.size, cached: cachedTails.size });
  const tailsByPath = new Map<string, Awaited<ReturnType<typeof updateTail>>>([
    ...cachedTails.entries(),
    ...tailEntries,
  ]);
  for (const ctx of codexContexts) {
    const { proc, cpu, mem, startMs, cmdRaw, cwdRaw, session, sessionId, reuseBlocked } = ctx;
    let doing: string | undefined;
    let events: AgentSnapshot["events"];
    let model: string | undefined;
    let hasError = false;
    let title: string | undefined;
    let summary: WorkSummary | undefined;
    let lastEventAt: number | undefined;
    let lastActivityAt: number | undefined;
    let inFlight = false;

    const pickBestJsonl = (paths?: string[]): string | undefined => {
      if (!paths || paths.length === 0) return undefined;
      let bestPath: string | undefined;
      let bestScore = -1;
      let bestActivity = -1;
      for (const candidate of paths) {
        const tail = includeActivity ? tailsByPath.get(candidate) : getTailState(candidate);
        const summary = tail ? summarizeTail(tail) : undefined;
        const inFlightScore = summary?.inFlight ? 1 : 0;
        const activity = summary?.lastActivityAt ?? summary?.lastEventAt ?? 0;
        const score = inFlightScore * 10 + (activity > 0 ? 1 : 0);
        if (score > bestScore || (score === bestScore && activity > bestActivity)) {
          bestScore = score;
          bestActivity = activity;
          bestPath = candidate;
        }
      }
      if (bestPath) return bestPath;
      const fallback = pickNewestJsonl(paths, jsonlMtimes);
      return normalizeSessionPath(fallback);
    };
    const sessionPath =
      pickBestJsonl(ctx.jsonlPaths) || normalizeSessionPath(session?.path);
    
    // Get thread state from event store (webhook-based events)
    let threadId: string | undefined;
    let threadState = undefined;
    if (sessionPath) {
      const meta = await getSessionMeta(sessionPath);
      threadId = meta?.id;
      if (threadId) {
        threadState = codexEventStore.getThreadState(threadId);
      }
    }
    
    // Event store provides authoritative inFlight + lastActivityAt if available
    const eventInFlight = threadState?.inFlight ?? false;
    const eventActivityAt = threadState?.lastActivityAt;

    let tailInFlight = false;
    let tailActivityAt: number | undefined;
    let tailEventAt: number | undefined;
    let tailInFlightSignalAt: number | undefined;
    let tailIngestAt: number | undefined;
    let tailEndAt: number | undefined;
    let tailReviewMode = false;
    let tailOpenCallCount = 0;

    if (sessionPath) {
      const tail = includeActivity ? tailsByPath.get(sessionPath) : getTailState(sessionPath);
      if (tail) {
        const tailSummary = summarizeTail(tail);
        doing = tailSummary.doing;
        events = tailSummary.events;
        model = tailSummary.model;
        hasError = tailSummary.hasError;
        title = normalizeTitle(tailSummary.title);
        summary = tailSummary.summary;
        tailInFlight = !!tailSummary.inFlight;
        tailActivityAt = tailSummary.lastActivityAt;
        tailEventAt = tailSummary.lastEventAt;
        tailInFlightSignalAt = tailSummary.lastInFlightSignalAt;
        tailIngestAt = tailSummary.lastIngestAt;
        tailEndAt = tailSummary.lastEndAt;
        tailReviewMode = !!tailSummary.reviewMode;
        tailOpenCallCount = tailSummary.openCallCount ?? 0;
      }
    }

    // Merge notify + JSONL tail events (no CPU/mtime heuristics)
    const tailActivityAtCandidate =
      typeof tailActivityAt === "number"
        ? tailActivityAt
        : typeof tailEventAt === "number"
          ? tailEventAt
          : undefined;
    const tailSignalAtCandidate =
      typeof tailInFlightSignalAt === "number"
        ? tailInFlightSignalAt
        : typeof tailIngestAt === "number"
          ? tailIngestAt
          : tailActivityAtCandidate;
    inFlight = eventInFlight || tailInFlight;
    const mergedActivityAt = Math.max(
      typeof eventActivityAt === "number" ? eventActivityAt : 0,
      typeof tailActivityAtCandidate === "number" ? tailActivityAtCandidate : 0
    );
    lastActivityAt = mergedActivityAt > 0 ? mergedActivityAt : undefined;
    lastEventAt = tailEventAt ?? eventActivityAt;

    if (!doing) {
      doing =
        parseDoingFromCmd(proc.cmd || "") || shortenCmd(proc.cmd || proc.name || "");
    }
    if (!summary && doing) {
      summary = { current: doing };
    }

    const cwd = redactText(cwdRaw) || cwdRaw;
    const repoRoot = cwdRaw ? findRepoRoot(cwdRaw) : null;
    const repoName = repoRoot ? path.basename(repoRoot) : undefined;

    const redactedSessionPath = sessionPath ? redactText(sessionPath) || sessionPath : undefined;
    const sessionIdentity =
      redactedSessionPath && !reuseBlocked
        ? `codex:${redactedSessionPath}`
        : `pid:${proc.pid}`;
    if (sessionPath) {
      pidSessionCache.set(proc.pid, { path: sessionPath, lastSeenAt: now, startMs });
    }
    const id = `${proc.pid}`;
    let cached = activityCache.get(id);
    if (isStartMsMismatch(cached?.startMs, startMs)) {
      activityCache.delete(id);
      cached = undefined;
    }
    // Event-driven state only (notify + JSONL events)
    const hasNotify = !!threadState;
    const hasTailEvents =
      typeof tailActivityAt === "number" ||
      typeof tailEventAt === "number" ||
      tailInFlight;
    const activityAt = typeof lastActivityAt === "number" ? lastActivityAt : undefined;
    let state: AgentState;
    let reason: string;
    if (!hasNotify && !hasTailEvents) {
      state = "idle";
      reason = "no_hook";
    } else {
      const tailAllowsNotifyEnd = tailOpenCallCount === 0 && !tailReviewMode;
      const notifyEndAt = !eventInFlight && eventActivityAt ? eventActivityAt : undefined;
      const notifyEndIsFresh =
        typeof notifyEndAt === "number" &&
        (typeof tailActivityAtCandidate !== "number" || notifyEndAt >= tailActivityAtCandidate);
      const notifyShouldEnd = tailAllowsNotifyEnd && notifyEndIsFresh && !tailEndAt;
      if (notifyShouldEnd) {
        inFlight = false;
      }
      const explicitEndAt = tailEndAt ?? (notifyShouldEnd ? notifyEndAt : undefined);
      const effectiveHoldMs = explicitEndAt ? 0 : codexHoldMs;
      const effectiveIdleMs = inFlight ? 0 : codexEventIdleMs;
      const eventState = deriveCodexEventState({
        inFlight,
        lastActivityAt: activityAt,
        hasError,
        now,
        holdMs: effectiveHoldMs,
        idleMs: effectiveIdleMs,
      });
      state = eventState.state;
      if (!hasNotify) {
        reason = eventState.reason?.startsWith("event_")
          ? eventState.reason.replace("event_", "tail_")
          : "tail";
      } else {
        reason = eventState.reason || "event";
      }
    }
    if (
      reason === "event_hold" &&
      typeof activityAt === "number" &&
      codexHoldMs > 0
    ) {
      bumpNextTickAt(activityAt + codexHoldMs);
    }
    const prevState = cached?.lastState;
    if (prevState && prevState !== state) {
      metricEffects.push(recordActivityTransition("codex", prevState, state, reason));
      trackTransition("codex", prevState, state, reason);
      logActivityDecision(
        `codex state ${prevState} -> ${state} pid=${proc.pid} reason=${reason} ` +
          `inFlight=${inFlight ? 1 : 0} ` +
          `lastActivity=${activityAt ?? "?"} ` +
          `eventStore=${hasNotify ? "yes" : "no"}`
      );
    }
    // Don't track CPU for Codex - we're event-driven now
    activityCache.set(id, {
      lastActiveAt: activityAt,
      lastSeenAt: now,
      lastState: state,
      lastReason: reason,
      startMs,
    });
    seenIds.add(id);
    const cmd = redactText(cmdRaw) || cmdRaw;
    const cmdShort = shortenCmd(cmd);
    const kind = inferKind(cmd);
    const startedAt = startMs ? Math.floor(startMs / 1000) : undefined;

    const computedTitle = title || deriveTitle(doing, repoName, proc.pid, kind);
    const safeSummary = sanitizeSummary(summary);

    agents.push({
      identity: sessionIdentity,
      id,
      pid: proc.pid,
      startedAt,
      lastEventAt,
      lastActivityAt: activityAt,
      activityReason: reason,
      title: redactText(computedTitle) || computedTitle,
      cmd,
      cmdShort,
      kind,
      cpu,
      mem,
      state,
      doing: redactText(doing) || doing,
      sessionPath: redactedSessionPath,
      repo: repoName,
      cwd,
      model,
      summary: safeSummary,
      events,
    });
  }

  const opencodeEventWindowMs = resolveMs(
    process.env.CONSENSUS_OPENCODE_EVENT_ACTIVE_MS,
    1000
  );
  const opencodeHoldMs = resolveMs(
    process.env.CONSENSUS_OPENCODE_ACTIVE_HOLD_MS,
    0
  );
  const opencodeStrictEnv = process.env.CONSENSUS_OPENCODE_STRICT_INFLIGHT;
  const opencodeStrictInFlight =
    opencodeStrictEnv === undefined || opencodeStrictEnv === ""
      ? false
      : opencodeStrictEnv === "1" || opencodeStrictEnv === "true";
  const opencodeInFlightIdleMs =
    process.env.CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS !== undefined
      ? resolveMs(process.env.CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS, 0)
      : undefined;
  const usedOpenCodeSessionIds = new Map<string, number>();
  for (const proc of opencodeProcs) {
    const stats = usage[proc.pid] || ({} as pidusage.Status);
    const cpu = typeof stats.cpu === "number" ? stats.cpu : 0;
    const mem = typeof stats.memory === "number" ? stats.memory : 0;

    const elapsed = (stats as pidusage.Status & { elapsed?: number }).elapsed;
    const startMs =
      typeof elapsed === "number"
        ? now - elapsed
        : startTimes.get(proc.pid);

    const cmdRaw = proc.cmd || proc.name || "";
    const kind = inferKind(cmdRaw);
    const isLspRun =
      kind === "opencode-cli" &&
      /opencode\s+run/i.test(cmdRaw) &&
      (cmdRaw.includes("language-server") || cmdRaw.includes(".local/share/opencode/bin/node_modules"));
    if (isLspRun) continue;
    const isServer = kind === "opencode-server";
    let cachedSessionId = opencodeSessionByPidCache.get(proc.pid)?.sessionId;
    const cwdMatch = cwds.get(proc.pid);
    // Check if cached session is still active; if not and there are active sessions available,
    // invalidate the cache to allow reassignment to an active session.
    if (cachedSessionId && cwdMatch && kind === "opencode-tui") {
      const activeIds = opencodeActiveSessionIdsByDir.get(cwdMatch);
      const cachedIsActive = activeIds?.includes(cachedSessionId);
      const hasAvailableActive = activeIds?.some(id => !usedOpenCodeSessionIds.has(id));
      logOpencode(`pid=${proc.pid} cachedSession=${cachedSessionId} activeIds=[${activeIds?.join(",") ?? ""}] cachedIsActive=${cachedIsActive} hasAvailableActive=${hasAvailableActive}`);
      if (!cachedIsActive && hasAvailableActive) {
        // Cached session is not active but there are active sessions available - allow reassignment
        logOpencode(`pid=${proc.pid} invalidating cache for inactive session ${cachedSessionId}`);
        cachedSessionId = undefined;
        opencodeSessionByPidCache.delete(proc.pid);
      }
    }
    const sessionByPid = isServer ? undefined : opencodeSessionsByPid.get(proc.pid);
    const selection = !isServer
      ? selectOpenCodeSessionForTui({
          pid: proc.pid,
          dir: kind === "opencode-tui" ? cwdMatch : undefined,
          sessionByPid,
          cachedSessionId,
          sessionsById: opencodeSessionsById,
          sessionsByDir: opencodeAllSessionsByDir,
          activeSessionIdsByDir: opencodeActiveSessionIdsByDir,
          usedSessionIds: usedOpenCodeSessionIds,
        })
      : { session: undefined, sessionId: undefined, source: "none" as const };
    const session = selection.session;
    let sessionId = selection.sessionId;
    const storageSession =
      !isServer && !session && cwdMatch
        ? await getOpenCodeSessionForDirectory(cwdMatch)
        : undefined;
    if (!isServer && !sessionId && storageSession) {
      const storageSessionId = getOpenCodeSessionId(storageSession);
      if (storageSessionId) {
        if (markOpenCodeSessionUsed(usedOpenCodeSessionIds, storageSessionId, proc.pid)) {
          sessionId = storageSessionId;
        }
      }
    }
    if (!isServer && !sessionId) {
      const extractedId = extractOpenCodeSessionId(cmdRaw);
      if (extractedId) {
        if (markOpenCodeSessionUsed(usedOpenCodeSessionIds, extractedId, proc.pid)) {
          sessionId = extractedId;
        }
      }
    }
    if (sessionId) {
      opencodeSessionByPidCache.set(proc.pid, { sessionId, lastSeenAt: now });
    }
    const sessionTitle = normalizeTitle(
      !isServer ? session?.title || session?.name || storageSession?.title : undefined
    );
    const sessionCwd =
      session?.cwd || session?.directory || storageSession?.directory;
    const cwdRaw = sessionCwd || cwds.get(proc.pid);
    const cwd = redactText(cwdRaw) || cwdRaw;
    const repoRoot = cwdRaw ? findRepoRoot(cwdRaw) : null;
    const repoName = repoRoot ? path.basename(repoRoot) : undefined;

    const apiUpdatedAt = parseTimestamp(
      session?.lastActivity ||
        session?.lastActivityAt ||
        storageSession?.time?.updated ||
        session?.time?.updated ||
        session?.updatedAt ||
        session?.updated
    );
    const apiCreatedAt = parseTimestamp(
      storageSession?.time?.created ||
        session?.time?.created ||
        session?.createdAt ||
        session?.created
    );
    let doing: string | undefined = isServer ? "opencode server" : sessionTitle;
    let summary: WorkSummary | undefined;
    let events: AgentSnapshot["events"];
    const eventActivity =
      !isServer
        ? getOpenCodeActivityBySession(sessionId) || getOpenCodeActivityByPid(proc.pid)
        : null;
    const statusAuthority = eventActivity?.lastStatus;
    const statusAuthorityLower =
      typeof statusAuthority === "string" ? statusAuthority.toLowerCase() : undefined;
    const statusAuthorityIsIdle = statusAuthorityLower === "idle";
    const statusAuthorityIsBusy =
      !!statusAuthorityLower && statusAuthorityLower !== "idle";

    const statusRaw = typeof session?.status === "string" ? session.status : undefined;
    const status = statusAuthorityLower ?? statusRaw?.toLowerCase();
    const statusIsError = !!status && /error|failed|failure/.test(status);
    const statusIsIdle = !!status && /idle|stopped|paused/.test(status);
    const statusIsActive = !!status && /running|active|processing|busy|retry/.test(status);
    let hasError = statusIsError;
    const model = typeof session?.model === "string" ? session.model : undefined;
    const includeOpenCode = shouldIncludeOpenCodeProcess({
      kind,
      opencodeApiAvailable,
      hasSession: !!session || !!storageSession,
      hasEventActivity: !!eventActivity,
    });
    if (!includeOpenCode) continue;
    if (debugOpencode && isServer && !opencodeServerLogged.has(proc.pid)) {
      opencodeServerLogged.add(proc.pid);
      process.stdout.write(
        `[consensus] opencode server detected pid=${proc.pid} cmd=${cmdRaw}\n`
      );
    }
    let lastEventAt: number | undefined;
    let lastActivityAt: number | undefined;
    let inFlight = eventActivity?.inFlight;
    if (eventActivity) {
      events = eventActivity.events;
      summary = eventActivity.summary || summary;
      if (typeof eventActivity.lastEventAt === "number") {
        if (typeof lastEventAt !== "number" || eventActivity.lastEventAt > lastEventAt) {
          lastEventAt = eventActivity.lastEventAt;
        }
      }
      if (typeof eventActivity.lastActivityAt === "number") {
        if (
          typeof lastActivityAt !== "number" ||
          eventActivity.lastActivityAt > lastActivityAt
        ) {
          lastActivityAt = eventActivity.lastActivityAt;
        }
      }
      if (eventActivity.hasError) hasError = true;
      if (eventActivity.inFlight) inFlight = true;
      if (eventActivity.summary?.current) doing = eventActivity.summary.current;
      if (statusAuthorityIsIdle) {
        inFlight = false;
      } else if (statusAuthorityIsBusy) {
        inFlight = true;
      }
    }
    // For TUI sessions, poll message API for activity; session.status (if present) is authoritative.
    if (!isServer && sessionId && opencodeApiAvailable) {
      const msgActivity = await getCachedOpenCodeSessionActivity(sessionId);
      if (msgActivity.ok) {
        if (!statusAuthorityLower || !statusAuthorityIsIdle) {
          // Message API is authoritative for TUI when no session status is known.
          inFlight = msgActivity.inFlight;
        }
        if (typeof msgActivity.lastActivityAt === "number") {
          lastActivityAt = lastActivityAt
            ? Math.max(lastActivityAt, msgActivity.lastActivityAt)
            : msgActivity.lastActivityAt;
        }
      }
    }
    const allowApiActivityAt = shouldUseOpenCodeApiActivityAt({
      status,
      apiUpdatedAt,
      apiCreatedAt,
    });
    const apiActivityAt = allowApiActivityAt ? apiUpdatedAt ?? apiCreatedAt : undefined;
    if (typeof apiActivityAt === "number") {
      lastEventAt =
        typeof lastEventAt === "number"
          ? Math.max(lastEventAt, apiActivityAt)
          : apiActivityAt;
      lastActivityAt =
        typeof lastActivityAt === "number"
          ? Math.max(lastActivityAt, apiActivityAt)
          : apiActivityAt;
    }
    if (statusIsIdle && !eventActivity?.inFlight && !inFlight) {
      inFlight = false;
    }
    if (!lastEventAt && statusIsIdle) {
      lastEventAt = undefined;
    }
    if (!doing) {
      doing =
        parseDoingFromCmd(proc.cmd || "") || shortenCmd(proc.cmd || proc.name || "");
    }
    if (doing) summary = { current: doing };

    // For TUI processes, use PID-based identity to avoid collapsing multiple TUIs onto one session.
    const sessionIdentity = isServer
      ? (sessionId ? `opencode:${sessionId}` : `pid:${proc.pid}`)
      : `pid:${proc.pid}`;
    const id = `${proc.pid}`;
    let cached = activityCache.get(id);
    if (isStartMsMismatch(cached?.startMs, startMs)) {
      activityCache.delete(id);
      cached = undefined;
    }
    const opencodeStartedRecently =
      typeof startMs === "number" && now - startMs <= opencodeHoldMs;
    const previousActiveAt = opencodeStartedRecently ? now : cached?.lastActiveAt;
    // Use inFlightIdleMs to avoid lingering in-flight states when activity stops.
    const useInFlightIdleMs = opencodeInFlightIdleMs;
    const activity = deriveOpenCodeState({
      hasError,
      lastEventAt,
      lastActivityAt,
      inFlight,
      status,
      isServer: kind === "opencode-server",
      previousActiveAt,
      now,
      eventWindowMs: opencodeEventWindowMs,
      holdMs: opencodeHoldMs,
      inFlightIdleMs: useInFlightIdleMs,
      strictInFlight: opencodeStrictInFlight,
    });
    let state = activity.state;
    let reason = activity.reason || "unknown";
    logOpencode(`pid=${proc.pid} sessionId=${sessionId ?? "none"} inFlight=${inFlight} state=${state} reason=${reason} lastActivityAt=${lastActivityAt ?? "?"} source=${selection.source}`);
    if (
      activity.state === "active" &&
      activity.reason === "hold" &&
      typeof activity.lastActiveAt === "number" &&
      opencodeHoldMs > 0
    ) {
      bumpNextTickAt(activity.lastActiveAt + opencodeHoldMs);
    }
    const hasSignal =
      statusIsIdle ||
      statusIsError ||
      typeof lastActivityAt === "number" ||
      typeof inFlight === "boolean";
    const activityAt = typeof lastActivityAt === "number" ? lastActivityAt : undefined;
    if (!opencodeApiAvailable && !hasSignal && !activity.lastActiveAt) {
      state = "idle";
      reason = "api_unavailable";
    }
    if (!hasSignal && !activity.lastActiveAt) {
      state = "idle";
      reason = "no_signal";
    }
    const prevState = cached?.lastState;
    if (prevState && prevState !== state) {
      metricEffects.push(recordActivityTransition("opencode", prevState, state, reason));
      trackTransition("opencode", prevState, state, reason);
      logActivityDecision(
        `opencode state ${prevState} -> ${state} pid=${proc.pid} reason=${reason} ` +
          `cpu=${cpu.toFixed(2)} inFlight=${inFlight ? 1 : 0} ` +
          `lastActivity=${lastActivityAt ?? "?"} status=${status ?? "?"}`
      );
    }
    activityCache.set(id, {
      lastActiveAt: activity.lastActiveAt,
      lastSeenAt: now,
      lastState: state,
      lastReason: reason,
      startMs,
    });
    seenIds.add(id);

    const cmd = redactText(cmdRaw) || cmdRaw;
    const cmdShort = shortenCmd(cmd);
    const startedAt = startMs ? Math.floor(startMs / 1000) : undefined;
    const computedTitle = sessionTitle || deriveTitle(doing, repoName, proc.pid, kind);
    const safeSummary = sanitizeSummary(summary);

    agents.push({
      identity: sessionIdentity,
      id,
      pid: proc.pid,
      startedAt,
      lastEventAt,
      lastActivityAt,
      activityReason: reason,
      title: redactText(computedTitle) || computedTitle,
      cmd,
      cmdShort,
      kind,
      cpu,
      mem,
      state,
      doing: redactText(doing) || doing,
      sessionPath: sessionId ? `opencode:${sessionId}` : undefined,
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
        ? now - elapsed
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
    let cached = activityCache.get(id);
    if (isStartMsMismatch(cached?.startMs, startMs)) {
      activityCache.delete(id);
      cached = undefined;
    }
    const sessionIdFromCmd = claudeInfo?.sessionId;
    const cachedSessionId = cached?.sessionId;
    let sessionState =
      sessionIdFromCmd ? getClaudeActivityBySession(sessionIdFromCmd, now) : undefined;
    if (!sessionState && cachedSessionId) {
      sessionState = getClaudeActivityBySession(cachedSessionId, now);
    }
    if (!sessionState && cwdRaw) {
      sessionState = getClaudeActivityByCwd(cwdRaw, now);
    }
    const sessionId = sessionState?.sessionId ?? sessionIdFromCmd ?? cachedSessionId;
    const eventInFlight = sessionState?.inFlight ?? false;
    const eventActivityAt = sessionState?.lastActivityAt;
    const previousActiveAt = cached?.lastActiveAt;
    const claudeHoldMs = resolveMs(
      process.env.CONSENSUS_CLAUDE_ACTIVE_HOLD_MS,
      3000
    );
    const activity = deriveStateWithHold({
      cpu: 0,
      hasError: false,
      lastEventAt: eventActivityAt,
      inFlight: eventInFlight,
      previousActiveAt,
      now,
      holdMs: claudeHoldMs,
    });
    const state = activity.state;
    const reason = activity.reason || "unknown";
    const activityAt = eventActivityAt ?? cached?.lastActiveAt;
    const prevState = cached?.lastState;
    if (prevState && prevState !== state) {
      metricEffects.push(recordActivityTransition("claude", prevState, state, reason));
      trackTransition("claude", prevState, state, reason);
      logActivityDecision(
        `claude state ${prevState} -> ${state} pid=${proc.pid} reason=${reason} ` +
          `inFlight=${eventInFlight ? 1 : 0} lastEvent=${eventActivityAt ?? "?"}`
      );
    }
    activityCache.set(id, {
      lastActiveAt: activity.lastActiveAt,
      lastSeenAt: now,
      lastCpuAboveAt: cached?.lastCpuAboveAt,
      lastState: state,
      lastReason: reason,
      startMs,
      sessionId: sessionId ?? cachedSessionId,
    });
    seenIds.add(id);

    const cmd = redactText(cmdRaw) || cmdRaw;
    const cmdShort = shortenCmd(cmd);
    const startedAt = startMs ? Math.floor(startMs / 1000) : undefined;
    const computedTitle = deriveTitle(doing, repoName, proc.pid, kind);
    const safeSummary = sanitizeSummary(summary);

    const sessionIdentity = sessionId ? `claude:${sessionId}` : `pid:${proc.pid}`;
    agents.push({
      identity: sessionIdentity,
      id,
      pid: proc.pid,
      startedAt,
      lastEventAt: eventActivityAt,
      title: redactText(computedTitle) || computedTitle,
      cmd,
      cmdShort,
      kind,
      cpu,
      mem,
      state,
      lastActivityAt: activityAt,
      activityReason: reason,
      doing: redactText(doing) || doing,
      sessionPath: sessionId ? `claude:${sessionId}` : undefined,
      repo: repoName,
      cwd,
      model,
      summary: safeSummary,
    });
  }

  const dedupedAgents = dedupeAgents(agents);
  const activityCounts = new Map<string, Record<AgentState, number>>();
  for (const agent of dedupedAgents) {
    const provider = providerForKind(agent.kind);
    const current = activityCounts.get(provider) || { active: 0, idle: 0, error: 0 };
    current[agent.state] += 1;
    activityCounts.set(provider, current);
  }
  const activityCountMeta: Record<string, Record<AgentState, number>> = {};
  for (const [provider, counts] of activityCounts.entries()) {
    activityCountMeta[provider] = counts;
    metricEffects.push(recordActivityCount(provider, "active", counts.active));
    metricEffects.push(recordActivityCount(provider, "idle", counts.idle));
    metricEffects.push(recordActivityCount(provider, "error", counts.error));
  }
  const activityTransitionMeta: Record<
    string,
    { total: number; byReason: Record<string, number>; byState: Record<string, number> }
  > = {};
  for (const [provider, summary] of activityTransitions.entries()) {
    activityTransitionMeta[provider] = summary;
  }
  if (metricEffects.length > 0) {
    void runPromise(Effect.all(metricEffects).pipe(Effect.asVoid)).catch((err) => {
      logActivityDecision(`metrics error: ${String(err)}`);
    });
  }

  if (includeActivity) {
    for (const id of activityCache.keys()) {
      if (!seenIds.has(id)) {
        activityCache.delete(id);
      }
    }
  }
  for (const pid of pidSessionCache.keys()) {
    if (!codexPidSet.has(pid)) {
      pidSessionCache.delete(pid);
    }
  }
  for (const pid of opencodeServerLogged.keys()) {
    if (!opencodePidSet.has(pid)) {
      opencodeServerLogged.delete(pid);
    }
  }
  for (const pid of opencodeSessionByPidCache.keys()) {
    if (!opencodePidSet.has(pid)) {
      opencodeSessionByPidCache.delete(pid);
    }
  }

  const hasCounts = Object.keys(activityCountMeta).length > 0;
  const hasTransitions = Object.keys(activityTransitionMeta).length > 0;
  const activityMeta =
    hasCounts || hasTransitions || typeof nextTickAt === "number"
      ? {
          ...(hasCounts ? { counts: activityCountMeta } : {}),
          ...(hasTransitions ? { transitions: activityTransitionMeta } : {}),
          ...(typeof nextTickAt === "number" ? { nextTickAt } : {}),
        }
      : undefined;
  const meta = {
    opencode: {
      ok: opencodeResult.ok,
      reachable: opencodeResult.reachable,
      status: opencodeResult.status,
      error: opencodeResult.error,
    },
    activity: activityMeta,
  };

  endProfile(scanTimer, { agents: dedupedAgents.length });
  return { ts: now, agents: dedupedAgents, meta };
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
