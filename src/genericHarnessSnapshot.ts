import path from "node:path";
import pidusage from "pidusage";
import psList from "ps-list";
import {
  detectGenericHarnessProcess,
  type DetectedHarnessProcess,
} from "./harnesses.js";
import { harnessCwdKey, harnessSessionKey } from "./harnessKeys.js";
import { redactText } from "./redact.js";
import type { AgentSnapshot, SnapshotPayload } from "./types.js";

export interface GenericHarnessProcess {
  pid: number;
  name?: string;
  cmd?: string;
}

export interface GenericHarnessUsage {
  cpu?: number;
  memory?: number;
  elapsed?: number;
}

export interface GenericHarnessSnapshotOptions {
  processes?: readonly GenericHarnessProcess[];
  usage?: Readonly<Record<number, GenericHarnessUsage>>;
  now?: number;
}

function shortenCommand(command: string, maxLength = 120): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
}

function commandTokens(command: string): string[] {
  return (
    command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) =>
      part.replace(/^["']|["']$/g, "")
    ) ?? []
  );
}

function extractFlagValue(
  tokens: string[],
  flags: ReadonlySet<string>
): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (flags.has(token)) {
      const value = tokens[index + 1];
      if (value && !value.startsWith("-")) return value;
    }
    for (const flag of flags) {
      if (token.startsWith(`${flag}=`)) {
        const value = token.slice(flag.length + 1);
        if (value) return value;
      }
    }
  }
  return undefined;
}

function extractCwd(command: string): string | undefined {
  return extractFlagValue(
    commandTokens(command),
    new Set(["--cwd", "--working-dir", "--workdir", "--dir"])
  );
}

function extractSessionId(command: string): string | undefined {
  const tokens = commandTokens(command);
  const direct = extractFlagValue(
    tokens,
    new Set(["--session", "--session-id", "--conversation-id", "-s"])
  );
  if (direct) return direct;

  const resumeIndex = tokens.findIndex(
    (token) => token === "resume" || token === "--resume"
  );
  if (resumeIndex >= 0) {
    const value = tokens[resumeIndex + 1];
    if (value && !value.startsWith("-")) return value;
  }
  return undefined;
}

async function loadUsage(
  pids: number[]
): Promise<Record<number, GenericHarnessUsage>> {
  if (pids.length === 0) return {};
  try {
    const result = await pidusage(pids);
    if (
      pids.length === 1 &&
      result &&
      typeof result === "object" &&
      "cpu" in result
    ) {
      return { [pids[0]]: result as GenericHarnessUsage };
    }
    return result as unknown as Record<number, GenericHarnessUsage>;
  } catch {
    return {};
  }
}

function processState(cpu: number): AgentSnapshot["state"] {
  const threshold = Number(process.env.CONSENSUS_GENERIC_CPU_ACTIVE || 1);
  return Number.isFinite(threshold) && cpu > threshold ? "active" : "idle";
}

function toAgentSnapshot(
  process: GenericHarnessProcess,
  detected: DetectedHarnessProcess,
  usage: GenericHarnessUsage,
  now: number
): AgentSnapshot {
  const commandRaw = process.cmd || process.name || detected.harness.displayName;
  const command = redactText(commandRaw) || commandRaw;
  const cwdRaw = extractCwd(commandRaw);
  const sessionId = extractSessionId(commandRaw);
  const cwd = redactText(cwdRaw) || cwdRaw;
  const cpu = typeof usage.cpu === "number" && Number.isFinite(usage.cpu) ? usage.cpu : 0;
  const mem =
    typeof usage.memory === "number" && Number.isFinite(usage.memory)
      ? usage.memory
      : 0;
  const elapsed =
    typeof usage.elapsed === "number" &&
    Number.isFinite(usage.elapsed) &&
    usage.elapsed >= 0
      ? usage.elapsed
      : undefined;
  const startedAt =
    typeof elapsed === "number"
      ? Math.max(0, Math.floor((now - elapsed) / 1000))
      : undefined;
  const state = processState(cpu);
  const role = detected.kind.endsWith("server") ? "server" : "agent";
  const startIdentity =
    typeof startedAt === "number" ? `:start:${startedAt}` : "";

  return {
    identity: `${detected.harness.id}:pid:${process.pid}${startIdentity}`,
    id: String(process.pid),
    pid: process.pid,
    startedAt,
    title: detected.harness.displayName,
    cmd: command,
    cmdShort: shortenCommand(command),
    kind: detected.kind,
    cpu,
    mem,
    state,
    activityReason: state === "active" ? "process_cpu" : "process_detected",
    doing: `${detected.harness.displayName} ${role}`,
    cwd,
    repo: cwdRaw ? path.basename(path.resolve(cwdRaw)) : undefined,
    harnessCwdKey: cwdRaw
      ? harnessCwdKey(detected.harness.id, cwdRaw)
      : undefined,
    harnessSessionKey: sessionId
      ? harnessSessionKey(detected.harness.id, sessionId)
      : undefined,
  };
}

export async function attachGenericHarnessProcesses(
  snapshot: SnapshotPayload,
  options: GenericHarnessSnapshotOptions = {}
): Promise<SnapshotPayload> {
  const processes = options.processes ?? (await psList());
  const existingPids = new Set(snapshot.agents.map((agent) => agent.pid));
  const matches = processes.flatMap((process) => {
    if (!Number.isInteger(process.pid) || process.pid < 0 || existingPids.has(process.pid)) {
      return [];
    }
    const detected = detectGenericHarnessProcess(process.cmd, process.name);
    return detected ? [{ process, detected }] : [];
  });
  if (matches.length === 0) return snapshot;

  const usage =
    options.usage ?? (await loadUsage(matches.map(({ process }) => process.pid)));
  const now = options.now ?? snapshot.ts;
  const additionalAgents = matches.map(({ process, detected }) =>
    toAgentSnapshot(process, detected, usage[process.pid] ?? {}, now)
  );

  return {
    ...snapshot,
    agents: [...snapshot.agents, ...additionalAgents],
  };
}
