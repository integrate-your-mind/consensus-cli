import { readFile } from "fs/promises";
import { buildAgentGraph, formatAgentGraph } from "../graph.js";
import { scanCodexProcesses } from "../scan.js";
import type { SnapshotPayload } from "../types.js";

function graphHelp(): string {
  return [
    "consensus graph",
    "",
    "Inspect live agent transitions as a graph and report detected loops.",
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
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
  }
  return input;
}

function parseSnapshot(input: string, source: string): SnapshotPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`invalid snapshot JSON from ${source}: ${String(error)}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as SnapshotPayload).ts !== "number" ||
    !Array.isArray((parsed as SnapshotPayload).agents)
  ) {
    throw new Error(`invalid snapshot payload from ${source}`);
  }

  return parsed as SnapshotPayload;
}

async function loadSnapshot(snapshotPath: string | undefined): Promise<SnapshotPayload> {
  if (!snapshotPath) {
    return scanCodexProcesses({ mode: "full" });
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
  process.stdout.write(json ? `${JSON.stringify(graph, null, 2)}\n` : formatAgentGraph(graph));
}
