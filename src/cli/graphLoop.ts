import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { loadGraphFile, GraphFileReadError } from "../graph/load.js";
import { hasGraphErrors } from "../graph/validate.js";
import type {
  ConsensusGraph,
  GraphAnalysis,
  GraphParseResult,
  GraphValidationIssue,
} from "../graph/types.js";
import { createJsonlEventLogger, defaultRunLogPath } from "../loop/logger.js";
import { runGraph } from "../loop/runner.js";
import type { GraphRunEvent, GraphRunResult } from "../loop/types.js";

interface RunCommandOptions {
  graphPath: string;
  dryRun: boolean;
  json: boolean;
  logEnabled: boolean;
  logPath?: string;
}

function writeStdout(value: string): void {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function writeStderr(value: string): void {
  process.stderr.write(value.endsWith("\n") ? value : `${value}\n`);
}

function graphCommandHelp(): string {
  return [
    "consensus graph",
    "",
    "Usage:",
    "  consensus graph validate <graph.json> [--json]",
    "  consensus graph inspect <graph.json> [--json]",
    "",
    "Commands:",
    "  validate   Parse the graph and check nodes, edges, cycles, and budgets",
    "  inspect    Print the normalized graph and structural analysis",
  ].join("\n");
}

function loopCommandHelp(): string {
  return [
    "consensus loop",
    "",
    "Usage:",
    "  consensus loop run <graph.json> [--dry-run] [--json] [--no-log] [--log <path>]",
    "",
    "Options:",
    "  --dry-run   Validate and inspect without executing nodes",
    "  --json      Emit machine-readable output",
    "  --no-log    Disable the JSONL run log",
    "  --log       Write the JSONL run log to an explicit path",
  ].join("\n");
}

function formatIssue(entry: GraphValidationIssue): string {
  return `${entry.severity.toUpperCase()} ${entry.code} ${entry.path}: ${entry.message}`;
}

function printIssues(issues: readonly GraphValidationIssue[]): void {
  for (const entry of issues) {
    const writer = entry.severity === "error" ? writeStderr : writeStdout;
    writer(formatIssue(entry));
  }
}

function graphSummary(
  filePath: string,
  graph: ConsensusGraph,
  analysis: GraphAnalysis | undefined,
): Record<string, unknown> {
  return {
    path: filePath,
    graph,
    analysis: analysis ?? null,
    summary: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      cycles: analysis?.cyclicEdges.length ?? 0,
      unreachableNodes: analysis?.unreachableNodeIds.length ?? 0,
      terminalNodes: analysis?.terminalNodeIds.length ?? 0,
    },
  };
}

function printGraphInspection(
  filePath: string,
  graph: ConsensusGraph,
  analysis: GraphAnalysis | undefined,
): void {
  writeStdout(`Graph: ${graph.id} (v${graph.version})`);
  writeStdout(`File: ${filePath}`);
  writeStdout(`Entry: ${graph.entry}`);
  writeStdout(`Nodes: ${graph.nodes.length}`);
  writeStdout(`Edges: ${graph.edges.length}`);
  writeStdout(`Budget: ${graph.budget.maxSteps} steps / ${graph.budget.maxDurationMs}ms`);
  writeStdout(`Cycles: ${analysis?.hasCycles ? `yes (${analysis.cyclicEdges.length} cyclic edges)` : "no"}`);
  writeStdout(
    `Terminal nodes: ${analysis?.terminalNodeIds.length ? analysis.terminalNodeIds.join(", ") : "none"}`,
  );
  writeStdout(
    `Unreachable nodes: ${analysis?.unreachableNodeIds.length ? analysis.unreachableNodeIds.join(", ") : "none"}`,
  );

  if (graph.edges.length > 0) {
    writeStdout("Transitions:");
    for (const edge of graph.edges) {
      const cap = edge.maxTraversals ? ` [max ${edge.maxTraversals}]` : "";
      writeStdout(`  ${edge.from} --${edge.on}--> ${edge.to}${cap}`);
    }
  }
}

function parseRunCommandOptions(args: readonly string[]): RunCommandOptions | string {
  let graphPath: string | undefined;
  let dryRun = false;
  let json = false;
  let logEnabled = true;
  let logPath: string | undefined;

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--no-log") {
      logEnabled = false;
    } else if (arg === "--log") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return "--log requires a path.";
      logPath = value;
      index += 1;
    } else if (arg.startsWith("--log=")) {
      logPath = arg.slice("--log=".length);
      if (!logPath) return "--log requires a path.";
    } else if (arg.startsWith("-")) {
      return `Unknown option: ${arg}`;
    } else if (!graphPath) {
      graphPath = arg;
    } else {
      return `Unexpected argument: ${arg}`;
    }
  }

  if (!graphPath) return "Missing graph file path.";
  if (!logEnabled && logPath) return "--no-log and --log cannot be used together.";

  return {
    graphPath,
    dryRun,
    json,
    logEnabled,
    ...(logPath ? { logPath } : {}),
  };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

function printRunEvent(event: GraphRunEvent): void {
  switch (event.type) {
    case "run.started":
      writeStdout(`[run ${event.runId}] graph=${event.graphId} entry=${event.entry}`);
      return;
    case "node.started":
      writeStdout(`[step ${event.step}] ${event.nodeId} started`);
      return;
    case "node.completed":
      writeStdout(
        `[step ${event.step}] ${event.nodeId} ${event.outcome} (${formatDuration(event.durationMs)})`,
      );
      return;
    case "edge.traversed": {
      const cap = event.maxTraversals ? `/${event.maxTraversals}` : "";
      writeStdout(
        `[edge] ${event.from} --${event.on}--> ${event.to} (${event.traversal}${cap})`,
      );
      return;
    }
    case "run.finished":
      return;
  }
}

function resultOutput(result: GraphRunResult, logPath?: string): Record<string, unknown> {
  return {
    ...result,
    logPath: logPath ?? null,
  };
}

async function loadValidatedGraph(graphPath: string): Promise<{
  path: string;
  result: GraphParseResult;
}> {
  const loaded = await loadGraphFile(graphPath);
  return { path: loaded.path, result: loaded.result };
}

async function runValidateOrInspect(
  action: "validate" | "inspect",
  graphPath: string,
  json: boolean,
): Promise<number> {
  const loaded = await loadValidatedGraph(graphPath);
  const invalid = hasGraphErrors(loaded.result);

  if (json) {
    writeStdout(
      JSON.stringify(
        {
          path: loaded.path,
          valid: !invalid,
          ...loaded.result,
        },
        null,
        2,
      ),
    );
  } else {
    printIssues(loaded.result.issues);
    if (loaded.result.graph && action === "inspect") {
      printGraphInspection(loaded.path, loaded.result.graph, loaded.result.analysis);
    } else if (!invalid) {
      writeStdout(`Valid graph: ${loaded.result.graph?.id ?? loaded.path}`);
    }
  }

  return invalid ? 1 : 0;
}

async function runLoopCommand(options: RunCommandOptions): Promise<number> {
  const loaded = await loadValidatedGraph(options.graphPath);
  const invalid = hasGraphErrors(loaded.result);
  const graph = loaded.result.graph;

  if (invalid || !graph) {
    if (options.json) {
      writeStdout(
        JSON.stringify(
          { path: loaded.path, valid: false, issues: loaded.result.issues },
          null,
          2,
        ),
      );
    } else {
      printIssues(loaded.result.issues);
    }
    return 1;
  }

  if (options.dryRun) {
    if (options.json) {
      writeStdout(JSON.stringify(graphSummary(loaded.path, graph, loaded.result.analysis), null, 2));
    } else {
      printIssues(loaded.result.issues);
      printGraphInspection(loaded.path, graph, loaded.result.analysis);
      writeStdout("Dry run: no commands executed.");
    }
    return 0;
  }

  const runId = randomUUID();
  const graphDirectory = path.dirname(loaded.path);
  const resolvedLogPath = options.logEnabled
    ? options.logPath
      ? path.resolve(process.cwd(), options.logPath)
      : defaultRunLogPath(graphDirectory, graph.id, runId)
    : undefined;
  const logger = resolvedLogPath ? await createJsonlEventLogger(resolvedLogPath) : undefined;
  const controller = new AbortController();
  const handleInterrupt = (): void => {
    if (!controller.signal.aborted) {
      writeStderr("[consensus] cancelling graph run...");
      controller.abort();
    }
  };
  process.once("SIGINT", handleInterrupt);

  let result: GraphRunResult;
  try {
    result = await runGraph(graph, {
      runId,
      baseDirectory: graphDirectory,
      signal: controller.signal,
      outputMode: options.json ? "stderr" : "inherit",
      onEvent: async (event) => {
        await logger?.write(event);
        if (!options.json) printRunEvent(event);
      },
    });
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
    await logger?.close();
  }

  if (options.json) {
    writeStdout(JSON.stringify(resultOutput(result, logger?.path), null, 2));
  } else {
    const reason = result.reason ? `: ${result.reason}` : "";
    writeStdout(
      `Run ${result.status} after ${result.steps} steps (${formatDuration(result.durationMs)})${reason}`,
    );
    if (logger) writeStdout(`Run log: ${logger.path}`);
  }

  return result.status === "completed" ? 0 : 1;
}

export async function runGraphLoopCommand(args: readonly string[]): Promise<number> {
  try {
    const [group, action] = args;
    if (group === "graph") {
      if (!action || action === "help" || action === "--help" || action === "-h") {
        writeStdout(graphCommandHelp());
        return 0;
      }
      if (action !== "validate" && action !== "inspect") {
        writeStderr(`Unknown graph command: ${action}`);
        writeStderr(graphCommandHelp());
        return 1;
      }

      const graphPath = args[2];
      if (!graphPath || graphPath.startsWith("-")) {
        writeStderr("Missing graph file path.");
        writeStderr(graphCommandHelp());
        return 1;
      }
      const unknown = args.slice(3).find((arg) => arg !== "--json");
      if (unknown) {
        writeStderr(`Unknown option: ${unknown}`);
        return 1;
      }
      return runValidateOrInspect(action, graphPath, args.includes("--json"));
    }

    if (group === "loop") {
      if (!action || action === "help" || action === "--help" || action === "-h") {
        writeStdout(loopCommandHelp());
        return 0;
      }
      if (action !== "run") {
        writeStderr(`Unknown loop command: ${action}`);
        writeStderr(loopCommandHelp());
        return 1;
      }

      const parsed = parseRunCommandOptions(args);
      if (typeof parsed === "string") {
        writeStderr(parsed);
        writeStderr(loopCommandHelp());
        return 1;
      }
      return runLoopCommand(parsed);
    }

    writeStderr("Expected graph or loop command.");
    return 1;
  } catch (error) {
    if (error instanceof GraphFileReadError) {
      writeStderr(`[consensus] ${error.message}`);
      return 1;
    }
    writeStderr(`[consensus] graph/loop error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
