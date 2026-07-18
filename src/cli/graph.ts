import { readFile } from "node:fs/promises";
import { buildAgentGraph, formatAgentGraph } from "../graph.js";
import type {
  AgentKind,
  AgentSnapshot,
  AgentState,
  EventSummary,
  SnapshotPayload,
} from "../types.js";

type SnapshotScanner = (options?: {
  mode?: "fast" | "full";
  includeActivity?: boolean;
}) => Promise<SnapshotPayload>;

export type GraphScanLoader = () => Promise<{
  scanCodexProcesses: SnapshotScanner;
}>;

const agentKinds = new Set<AgentKind>([
  "tui",
  "exec",
  "app-server",
  "opencode-tui",
  "opencode-cli",
  "opencode-server",
  "claude-tui",
  "claude-cli",
  "unknown",
]);
const agentStates = new Set<AgentState>(["active", "idle", "error"]);

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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("--snapshot - requires JSON piped on stdin");
  }
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalTurnId(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isEventSummary(value: unknown): value is EventSummary {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.ts) &&
    typeof value.type === "string" &&
    typeof value.summary === "string" &&
    (value.isError === undefined || typeof value.isError === "boolean") &&
    isOptionalTurnId(value.turnId)
  );
}

function isAgentSnapshot(value: unknown): value is AgentSnapshot {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    !isFiniteNumber(value.pid) ||
    typeof value.cmd !== "string" ||
    typeof value.cmdShort !== "string" ||
    typeof value.kind !== "string" ||
    !agentKinds.has(value.kind as AgentKind) ||
    typeof value.state !== "string" ||
    !agentStates.has(value.state as AgentState) ||
    !isFiniteNumber(value.cpu) ||
    !isFiniteNumber(value.mem)
  ) {
    return false;
  }
  if (
    !isOptionalString(value.identity) ||
    !isOptionalString(value.title) ||
    !isOptionalString(value.doing) ||
    !isOptionalString(value.sessionPath) ||
    !isOptionalString(value.repo) ||
    !isOptionalString(value.cwd) ||
    !isOptionalString(value.model)
  ) {
    return false;
  }
  if (value.events !== undefined) {
    if (!Array.isArray(value.events) || !value.events.every(isEventSummary)) {
      return false;
    }
  }
  return true;
}

export function parseSnapshot(input: string, source: string): SnapshotPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`invalid snapshot JSON from ${source}: ${String(error)}`);
  }

  if (
    !isRecord(parsed) ||
    !isFiniteNumber(parsed.ts) ||
    !Array.isArray(parsed.agents) ||
    !parsed.agents.every(isAgentSnapshot)
  ) {
    throw new Error(`invalid snapshot payload from ${source}`);
  }

  return parsed as unknown as SnapshotPayload;
}

const defaultScanLoader: GraphScanLoader = async () =>
  (await import("../scan.js")) as {
    scanCodexProcesses: SnapshotScanner;
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

export async function loadSnapshot(
  snapshotPath: string | undefined,
  loadScan: GraphScanLoader = defaultScanLoader
): Promise<SnapshotPayload> {
  if (!snapshotPath) {
    return loadLiveSnapshot(loadScan);
  }

  const input =
    snapshotPath === "-" ? await readStdin() : await readFile(snapshotPath, "utf8");
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
