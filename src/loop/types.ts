import type { ConsensusGraph, GraphEdge, GraphNode } from "../graph/types.js";

export type NodeOutcome = "success" | "failure";
export type NodeOutputMode = "inherit" | "stderr";
export type GraphRunStatus = "completed" | "failed" | "budget_exhausted" | "cancelled";

export interface NodeExecutionResult {
  outcome: NodeOutcome;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  error?: string;
  timedOut?: boolean;
}

export interface NodeExecutionContext {
  graph: ConsensusGraph;
  runId: string;
  step: number;
  baseDirectory: string;
  signal?: AbortSignal;
  outputMode?: NodeOutputMode;
}

export type NodeExecutor = (
  node: GraphNode,
  context: NodeExecutionContext,
) => Promise<NodeExecutionResult>;

interface GraphRunEventBase {
  sequence: number;
  ts: number;
  runId: string;
  graphId: string;
}

export interface RunStartedEvent extends GraphRunEventBase {
  type: "run.started";
  entry: string;
  budget: ConsensusGraph["budget"];
}

export interface NodeStartedEvent extends GraphRunEventBase {
  type: "node.started";
  nodeId: string;
  step: number;
}

export interface NodeCompletedEvent extends GraphRunEventBase {
  type: "node.completed";
  nodeId: string;
  step: number;
  outcome: NodeOutcome;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  error?: string;
  timedOut?: boolean;
}

export interface EdgeTraversedEvent extends GraphRunEventBase {
  type: "edge.traversed";
  from: string;
  to: string;
  on: GraphEdge["on"];
  traversal: number;
  maxTraversals?: number;
}

export interface RunFinishedEvent extends GraphRunEventBase {
  type: "run.finished";
  status: GraphRunStatus;
  steps: number;
  durationMs: number;
  lastNodeId?: string;
  reason?: string;
}

export type GraphRunEvent =
  | RunStartedEvent
  | NodeStartedEvent
  | NodeCompletedEvent
  | EdgeTraversedEvent
  | RunFinishedEvent;

export interface GraphRunOptions {
  baseDirectory?: string;
  runId?: string;
  signal?: AbortSignal;
  outputMode?: NodeOutputMode;
  executeNode?: NodeExecutor;
  onEvent?: (event: GraphRunEvent) => void | Promise<void>;
  now?: () => number;
}

export interface GraphRunResult {
  runId: string;
  graphId: string;
  status: GraphRunStatus;
  steps: number;
  durationMs: number;
  lastNodeId?: string;
  reason?: string;
  edgeTraversalCounts: Readonly<Record<string, number>>;
}
