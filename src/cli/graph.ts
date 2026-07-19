import { readFile, stat } from "node:fs/promises";
import { buildAgentGraph, formatAgentGraph } from "../graph.js";
import { isAgentKind } from "../harnesses.js";
import type {
  AgentSnapshot,
  AgentState,
  EventSummary,
  SnapshotPayload,
  WorkSummary,
} from "../types.js";

type SnapshotScanner = (options?: {
  mode?: "fast" | "full";
  includeActivity?: boolean;
}) => Promise<SnapshotPayload>;

export type GraphScanLoader = () => Promise<{
  scanCodexProcesses: SnapshotScanner;
}>;

const agentStates = new Set<AgentState>(["active", "idle", "error"]);
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_AGENTS = 10_000;
const MAX_EVENTS_PER_AGENT = 10_000;
const MAX_TEXT_LENGTH = 16_384;
const MAX_EVENT_TYPE_LENGTH = 256;
const MAX_EVENT_SUMMARY_LENGTH = 4_096;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

function graphHelp(): string {
  return [
    "consensus graph",
    "",
    "Inspect observed agent transitions as a graph and report detected loops.",
    "",
    "Usage:",
    "  consensus graph [--json] [--snapshot <path|->]",
    "",
    "Options:",
    "  --json               Print the full graph snapshot as JSON",
    "  --snapshot <path|->  Read a saved snapshot file, or '-' for stdin",
    "  -h, --help           Show graph command help",
    "",
  ].join("\n");
}

function snapshotTooLarge(source: string): Error {
  return new Error(
    `snapshot from ${source} exceeds ${MAX_SNAPSHOT_BYTES} bytes`
  );
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("--snapshot - requires JSON piped on stdin");
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_SNAPSHOT_BYTES) throw snapshotTooLarge("stdin");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSafeString(value: unknown, maxLength: number = MAX_TEXT_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    !CONTROL_CHARACTER_RE.test(value)
  );
}

function isNonEmptySafeString(
  value: unknown,
  maxLength: number = MAX_TEXT_LENGTH
): value is string {
  return isSafeString(value, maxLength) && value.length > 0;
}

function isOptionalSafeString(
  value: unknown,
  maxLength: number = MAX_TEXT_LENGTH
): boolean {
  return value === undefined || isSafeString(value, maxLength);
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || isNonNegativeFiniteNumber(value);
}

function isOptionalTurnId(value: unknown): boolean {
  return (
    value === undefined ||
    isNonEmptySafeString(value, MAX_EVENT_TYPE_LENGTH) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isWorkSummary(value: unknown): value is WorkSummary | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return [
    value.current,
    value.lastCommand,
    value.lastEdit,
    value.lastMessage,
    value.lastTool,
    value.lastPrompt,
  ].every((entry) => isOptionalSafeString(entry, MAX_EVENT_SUMMARY_LENGTH));
}

function isEventSummary(value: unknown): value is EventSummary {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeFiniteNumber(value.ts) &&
    isNonEmptySafeString(value.type, MAX_EVENT_TYPE_LENGTH) &&
    isSafeString(value.summary, MAX_EVENT_SUMMARY_LENGTH) &&
    (value.isError === undefined || typeof value.isError === "boolean") &&
    isOptionalTurnId(value.turnId)
  );
}

function isAgentSnapshot(value: unknown): value is AgentSnapshot {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptySafeString(value.id) ||
    !isNonNegativeInteger(value.pid) ||
    !isNonEmptySafeString(value.cmd) ||
    !isNonEmptySafeString(value.cmdShort) ||
    !isAgentKind(value.kind) ||
    typeof value.state !== "string" ||
    !agentStates.has(value.state as AgentState) ||
    !isNonNegativeFiniteNumber(value.cpu) ||
    !isNonNegativeFiniteNumber(value.mem)
  ) {
    return false;
  }
  if (
    !isOptionalSafeString(value.identity) ||
    !isOptionalSafeString(value.title) ||
    !isOptionalSafeString(value.doing) ||
    !isOptionalSafeString(value.sessionPath) ||
    !isOptionalSafeString(value.repo) ||
    !isOptionalSafeString(value.cwd) ||
    !isOptionalSafeString(value.model) ||
    !isOptionalSafeString(value.activityReason)
  ) {
    return false;
  }
  if (
    !isOptionalTimestamp(value.startedAt) ||
    !isOptionalTimestamp(value.lastEventAt) ||
    !isOptionalTimestamp(value.lastActivityAt) ||
    !isWorkSummary(value.summary)
  ) {
    return false;
  }
  if (value.events !== undefined) {
    if (
      !Array.isArray(value.events) ||
      value.events.length > MAX_EVENTS_PER_AGENT ||
      !value.events.every(isEventSummary)
    ) {
      return false;
    }
  }
  return true;
}

export function parseSnapshot(input: string, source: string): SnapshotPayload {
  if (Buffer.byteLength(input, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw snapshotTooLarge(source);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`invalid snapshot JSON from ${source}: ${String(error)}`);
  }

  if (
    !isRecord(parsed) ||
    !isNonNegativeFiniteNumber(parsed.ts) ||
    !Array.isArray(parsed.agents) ||
    parsed.agents.length > MAX_AGENTS ||
    !parsed.agents.every(isAgentSnapshot)
  ) {
    throw new Error(`invalid snapshot payload from ${source}`);
  }

  return parsed as unknown as SnapshotPayload;
}

const defaultScanLoader: GraphScanLoader = async () => {
  const { scanSnapshot } = await import("../scanSnapshot.js");
  return { scanCodexProcesses: scanSnapshot };
};

async function loadLiveSnapshot(
  loadScan: GraphScanLoader = defaultScanLoader
): Promise<SnapshotPayload> {
  const previousAutostart = process.env.CONSENSUS_OPENCODE_AUTOSTART;
  process.env.CONSENSUS_OPENCODE_AUTOSTART = "0";
  try {
    const { scanCodexProcesses } = await loadScan();
    return await scanCodexProcesses({ mode: "full" });
  } finally {
    if (previousAutostart === undefined) {
      delete process.env.CONSENSUS_OPENCODE_AUTOSTART;
    } else {
      process.env.CONSENSUS_OPENCODE_AUTOSTART = previousAutostart;
    }
  }
}

async function readSnapshotFile(snapshotPath: string): Promise<string> {
  const info = await stat(snapshotPath);
  if (info.size > MAX_SNAPSHOT_BYTES) throw snapshotTooLarge(snapshotPath);
  return readFile(snapshotPath, "utf8");
}

export async function loadSnapshot(
  snapshotPath: string | undefined,
  loadScan: GraphScanLoader = defaultScanLoader
): Promise<SnapshotPayload> {
  if (!snapshotPath) return loadLiveSnapshot(loadScan);

  const input =
    snapshotPath === "-" ? await readStdin() : await readSnapshotFile(snapshotPath);
  return parseSnapshot(input, snapshotPath === "-" ? "stdin" : snapshotPath);
}

export async function runGraph(args: string[]): Promise<void> {
  let json = false;
  let snapshotPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(graphHelp());
      return;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--snapshot") {
      snapshotPath = args[index + 1];
      if (!snapshotPath) throw new Error("--snapshot requires a path or '-'");
      index += 1;
      continue;
    }
    if (arg.startsWith("--snapshot=")) {
      snapshotPath = arg.slice("--snapshot=".length);
      if (!snapshotPath) throw new Error("--snapshot requires a path or '-'");
      continue;
    }
    throw new Error(`unknown graph option: ${arg}`);
  }

  const snapshot = await loadSnapshot(snapshotPath);
  const graph = buildAgentGraph(snapshot);
  process.stdout.write(
    json ? `${JSON.stringify(graph, null, 2)}\n` : formatAgentGraph(graph)
  );
}
