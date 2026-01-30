import { deriveStateWithHold } from "./activity.js";
import type { ActivityHoldResult } from "./activity.js";

export type ClaudeKind = "claude-tui" | "claude-cli";

export interface ClaudeCommandInfo {
  kind: ClaudeKind;
  prompt?: string;
  resume?: string;
  continued?: boolean;
  model?: string;
  print?: boolean;
  sessionId?: string;
}

export interface ClaudeActivityInput {
  cpu: number;
  info?: ClaudeCommandInfo | null;
  previousActiveAt?: number;
  now?: number;
  cpuThreshold?: number;
  cpuActiveMs?: number;
  cpuSustainMs?: number;
  cpuSpikeThreshold?: number;
  holdMs?: number;
}

const CLAUDE_BINARIES = new Set(["claude", "claude.exe"]);

export function splitArgs(command: string): string[] {
  if (!command) return [];
  const args: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    const token = match[1] ?? match[2] ?? match[0];
    if (token) args.push(token);
  }
  return args;
}

function findClaudeIndex(parts: string[]): number {
  for (let i = 0; i < parts.length; i += 1) {
    const base = parts[i] ? parts[i].split(/[/\\]/).pop() || "" : "";
    if (CLAUDE_BINARIES.has(base)) return i;
  }
  return -1;
}

function readFlagValue(parts: string[], flag: string): string | undefined {
  const idx = parts.indexOf(flag);
  if (idx === -1) return undefined;
  const value = parts[idx + 1];
  if (!value || value.startsWith("-")) return undefined;
  return value;
}

function findPrompt(parts: string[], startIndex: number): string | undefined {
  for (let i = startIndex; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (part === "-p" || part === "--print") {
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) return next;
    }
    if (part.startsWith("-")) {
      const skipFlags = new Set([
        "--output-format",
        "--input-format",
        "--model",
        "--max-turns",
        "--max-budget-usd",
        "--tools",
        "--allowedTools",
        "--disallowedTools",
        "--resume",
        "-r",
        "--session-id",
        "--session",
        "-s",
        "--continue",
        "-c",
      ]);
      if (skipFlags.has(part)) {
        i += 1;
      }
      continue;
    }
    return part;
  }
  return undefined;
}

export function parseClaudeCommand(command: string): ClaudeCommandInfo | null {
  const parts = splitArgs(command);
  const claudeIndex = findClaudeIndex(parts);
  if (claudeIndex === -1) return null;

  const hasPrint = parts.includes("-p") || parts.includes("--print");
  const continued = parts.includes("--continue") || parts.includes("-c");
  const resume = readFlagValue(parts, "--resume") || readFlagValue(parts, "-r");
  const model = readFlagValue(parts, "--model");
  const sessionId =
    readFlagValue(parts, "--session-id") ||
    readFlagValue(parts, "--session") ||
    readFlagValue(parts, "-s");
  const prompt = findPrompt(parts, claudeIndex + 1);

  return {
    kind: hasPrint ? "claude-cli" : "claude-tui",
    prompt,
    resume,
    continued,
    model,
    print: hasPrint,
    sessionId,
  };
}

export function summarizeClaudeCommand(command: string): ClaudeCommandInfo & { doing: string } | null {
  const info = parseClaudeCommand(command);
  if (!info) return null;
  if (info.prompt) {
    return { ...info, doing: `prompt: ${info.prompt}` };
  }
  if (info.resume) {
    return { ...info, doing: `resume: ${info.resume}` };
  }
  if (info.continued) {
    return { ...info, doing: "continue" };
  }
  if (info.print) {
    return { ...info, doing: "claude print" };
  }
  return { ...info, doing: "claude" };
}

export function deriveClaudeState(input: ClaudeActivityInput): ActivityHoldResult {
  const info = input.info ?? null;
  const baseThreshold =
    input.cpuThreshold ??
    Number(process.env.CONSENSUS_CLAUDE_CPU_ACTIVE || process.env.CONSENSUS_CPU_ACTIVE || 1);
  const hasWork =
    info?.kind === "claude-cli" && (!!info?.prompt || !!info?.resume || !!info?.continued);
  const now = input.now ?? Date.now();
  const isTui = info?.kind === "claude-tui";
  const effectiveThreshold = isTui && !hasWork ? baseThreshold * 3 : baseThreshold;
  const sustainMs =
    input.cpuSustainMs ??
    Number(process.env.CONSENSUS_CLAUDE_CPU_SUSTAIN_MS || 1000);
  const spikeEnv = Number(process.env.CONSENSUS_CLAUDE_CPU_SPIKE || "");
  const spikeThreshold =
    input.cpuSpikeThreshold ??
    (Number.isFinite(spikeEnv) && spikeEnv > 0
      ? spikeEnv
      : Math.max(effectiveThreshold * 2, 5));
  const allowSpikes = !(isTui && !hasWork);
  const sustained = allowSpikes
    ? input.cpu >= spikeThreshold ||
      (typeof input.cpuActiveMs === "number" && input.cpuActiveMs >= sustainMs)
    : typeof input.cpuActiveMs === "number" && input.cpuActiveMs >= sustainMs;
  const cpuValue = isTui && !hasWork && !sustained ? 0 : input.cpu;
  const holdMs =
    input.holdMs ?? Number(process.env.CONSENSUS_CLAUDE_ACTIVE_HOLD_MS || 3000);
  const result = deriveStateWithHold({
    cpu: cpuValue,
    hasError: false,
    lastEventAt: undefined,
    inFlight: undefined,
    previousActiveAt: input.previousActiveAt,
    now,
    cpuThreshold: effectiveThreshold,
    holdMs,
  });
  if (cpuValue <= effectiveThreshold && !sustained) {
    if (result.state === "active") return result;
    return { state: "idle", lastActiveAt: input.previousActiveAt, reason: "cpu_below" };
  }
  return result;
}

export function getClaudeCpuThreshold(
  info: ClaudeCommandInfo | null | undefined,
  baseThreshold: number
): number {
  const hasWork =
    info?.kind === "claude-cli" && (!!info?.prompt || !!info?.resume || !!info?.continued);
  const isTui = info?.kind === "claude-tui";
  return isTui && !hasWork ? baseThreshold * 3 : baseThreshold;
}
