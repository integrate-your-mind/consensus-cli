import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ConsensusGraph, GraphEdge, GraphNode } from "../graph/types.js";
import type {
  GraphRunEvent,
  GraphRunOptions,
  GraphRunResult,
  GraphRunStatus,
  NodeExecutionContext,
  NodeExecutionResult,
  NodeExecutor,
  NodeOutcome,
} from "./types.js";

const FORCE_KILL_DELAY_MS = 2_000;

function outcomeForExitCode(exitCode: number | null): NodeOutcome {
  return exitCode === 0 ? "success" : "failure";
}

export const executeCommandNode: NodeExecutor = async (
  node: GraphNode,
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  if (context.signal?.aborted) {
    return {
      outcome: "failure",
      exitCode: null,
      signal: null,
      durationMs: 0,
      error: "Run cancelled before node execution.",
    };
  }

  const startedAt = Date.now();
  const [command, ...args] = node.command;
  const cwd = node.cwd ? path.resolve(context.baseDirectory, node.cwd) : context.baseDirectory;

  return new Promise<NodeExecutionResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    let forceKillTimeout: NodeJS.Timeout | undefined;

    const finish = (result: Omit<NodeExecutionResult, "durationMs">): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      context.signal?.removeEventListener("abort", onAbort);
      resolve({ ...result, durationMs: Math.max(0, Date.now() - startedAt) });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...node.env },
        stdio:
          context.outputMode === "stderr"
            ? ["inherit", process.stderr, process.stderr]
            : "inherit",
        shell: process.platform === "win32",
        windowsHide: true,
      });
    } catch (error) {
      finish({
        outcome: "failure",
        exitCode: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    function stopChild(): void {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, FORCE_KILL_DELAY_MS);
      forceKillTimeout.unref();
    }

    function onAbort(): void {
      stopChild();
    }

    child.once("error", (error) => {
      finish({
        outcome: "failure",
        exitCode: null,
        signal: null,
        error: error.message,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });

    child.once("close", (exitCode, signal) => {
      finish({
        outcome: timedOut ? "failure" : outcomeForExitCode(exitCode),
        exitCode,
        signal,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });

    context.signal?.addEventListener("abort", onAbort, { once: true });
    if (context.signal?.aborted) onAbort();

    if (node.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        stopChild();
      }, node.timeoutMs);
      timeout.unref();
    }
  });
};

function selectEdge(
  graph: ConsensusGraph,
  nodeId: string,
  outcome: NodeOutcome,
): { edge: GraphEdge; index: number } | undefined {
  const outgoing = graph.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.from === nodeId);

  return (
    outgoing.find(({ edge }) => edge.on === outcome) ??
    outgoing.find(({ edge }) => edge.on === "always")
  );
}

function edgeKey(edge: GraphEdge, index: number): string {
  return `${index}:${edge.from}->${edge.to}:${edge.on}`;
}

export async function runGraph(
  graph: ConsensusGraph,
  options: GraphRunOptions = {},
): Promise<GraphRunResult> {
  const runId = options.runId ?? randomUUID();
  const baseDirectory = path.resolve(options.baseDirectory ?? process.cwd());
  const executeNode = options.executeNode ?? executeCommandNode;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const runController = new AbortController();
  let durationExceeded = false;
  const forwardAbort = (): void => runController.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) runController.abort();
  const durationTimeout = setTimeout(() => {
    durationExceeded = true;
    runController.abort();
  }, graph.budget.maxDurationMs);
  durationTimeout.unref();
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeTraversalCounts = new Map<string, number>();
  let sequence = 0;
  let steps = 0;
  let currentNodeId: string | undefined = graph.entry;
  let lastNodeId: string | undefined;

  const publish = async (event: GraphRunEvent): Promise<void> => {
    await options.onEvent?.(event);
  };

  const createBase = () => ({
    sequence: sequence++,
    ts: now(),
    runId,
    graphId: graph.id,
  });

  const finish = async (
    status: GraphRunStatus,
    reason?: string,
  ): Promise<GraphRunResult> => {
    clearTimeout(durationTimeout);
    options.signal?.removeEventListener("abort", forwardAbort);
    const durationMs = Math.max(0, now() - startedAt);
    await publish({
      ...createBase(),
      type: "run.finished",
      status,
      steps,
      durationMs,
      ...(lastNodeId ? { lastNodeId } : {}),
      ...(reason ? { reason } : {}),
    });

    return {
      runId,
      graphId: graph.id,
      status,
      steps,
      durationMs,
      ...(lastNodeId ? { lastNodeId } : {}),
      ...(reason ? { reason } : {}),
      edgeTraversalCounts: Object.fromEntries(edgeTraversalCounts),
    };
  };

  await publish({
    ...createBase(),
    type: "run.started",
    entry: graph.entry,
    budget: graph.budget,
  });

  while (currentNodeId) {
    if (options.signal?.aborted) {
      return finish("cancelled", "Run cancelled.");
    }

    if (steps >= graph.budget.maxSteps) {
      return finish(
        "budget_exhausted",
        `Step budget exhausted at ${graph.budget.maxSteps} node executions.`,
      );
    }

    if (durationExceeded || now() - startedAt >= graph.budget.maxDurationMs) {
      return finish(
        "budget_exhausted",
        `Duration budget exhausted at ${graph.budget.maxDurationMs}ms.`,
      );
    }

    const node = nodesById.get(currentNodeId);
    if (!node) {
      return finish("failed", `Node "${currentNodeId}" does not exist.`);
    }

    steps += 1;
    lastNodeId = node.id;
    await publish({
      ...createBase(),
      type: "node.started",
      nodeId: node.id,
      step: steps,
    });

    const result = await executeNode(node, {
      graph,
      runId,
      step: steps,
      baseDirectory,
      signal: runController.signal,
      outputMode: options.outputMode ?? "inherit",
    });

    await publish({
      ...createBase(),
      type: "node.completed",
      nodeId: node.id,
      step: steps,
      outcome: result.outcome,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      ...(result.error ? { error: result.error } : {}),
      ...(result.timedOut ? { timedOut: true } : {}),
    });

    if (options.signal?.aborted) {
      return finish("cancelled", "Run cancelled.");
    }

    if (durationExceeded || now() - startedAt >= graph.budget.maxDurationMs) {
      return finish(
        "budget_exhausted",
        `Duration budget exhausted at ${graph.budget.maxDurationMs}ms.`,
      );
    }

    const selected = selectEdge(graph, node.id, result.outcome);
    if (!selected) {
      return finish(
        result.outcome === "success" ? "completed" : "failed",
        result.outcome === "failure"
          ? result.error ?? `Node "${node.id}" failed with exit code ${String(result.exitCode)}.`
          : undefined,
      );
    }

    const key = edgeKey(selected.edge, selected.index);
    const traversal = (edgeTraversalCounts.get(key) ?? 0) + 1;
    if (selected.edge.maxTraversals && traversal > selected.edge.maxTraversals) {
      return finish(
        "budget_exhausted",
        `Edge "${selected.edge.from}" -> "${selected.edge.to}" exceeded maxTraversals=${selected.edge.maxTraversals}.`,
      );
    }

    edgeTraversalCounts.set(key, traversal);
    await publish({
      ...createBase(),
      type: "edge.traversed",
      from: selected.edge.from,
      to: selected.edge.to,
      on: selected.edge.on,
      traversal,
      ...(selected.edge.maxTraversals
        ? { maxTraversals: selected.edge.maxTraversals }
        : {}),
    });

    currentNodeId = selected.edge.to;
  }

  return finish("completed");
}
