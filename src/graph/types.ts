export type GraphEdgeCondition = "success" | "failure" | "always";

export interface GraphNode {
  id: string;
  label?: string;
  command: readonly [string, ...string[]];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  on: GraphEdgeCondition;
  maxTraversals?: number;
}

export interface GraphBudget {
  maxSteps: number;
  maxDurationMs: number;
}

export interface ConsensusGraph {
  version: 1;
  id: string;
  entry: string;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  budget: GraphBudget;
}

export type GraphValidationSeverity = "error" | "warning";

export interface GraphValidationIssue {
  severity: GraphValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface CyclicEdge {
  index: number;
  from: string;
  to: string;
  maxTraversals?: number;
}

export interface GraphAnalysis {
  reachableNodeIds: readonly string[];
  unreachableNodeIds: readonly string[];
  terminalNodeIds: readonly string[];
  cyclicEdges: readonly CyclicEdge[];
  hasCycles: boolean;
}

export interface GraphParseResult {
  graph?: ConsensusGraph;
  issues: readonly GraphValidationIssue[];
  analysis?: GraphAnalysis;
}
