import type { AgentState } from "./types.js";

export type GraphNodeKind = "agent" | "step";
export type GraphEdgeKind = "contains" | "transition";
export type GraphLoopKind = "self" | "cycle";
export type GraphHistoryStatus = "available" | "partial" | "unavailable";

export interface AgentGraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  state: AgentState;
  agentKey: string;
  provider: string;
  repo?: string;
  phase?: string;
  segment?: number;
  current?: boolean;
  hadError?: boolean;
  eventTypes?: string[];
  firstSeenAt?: number;
  lastSeenAt?: number;
  observations?: number;
}

export interface AgentGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  observations: number;
  lastSeenAt?: number;
}

export interface AgentGraphLoop {
  id: string;
  kind: GraphLoopKind;
  nodeIds: string[];
  edgeIds: string[];
  agentKeys: string[];
  providers: string[];
  segments: number[];
  state: AgentState;
  transitionObservations: number;
  lastSeenAt?: number;
}

export interface AgentGraphWindow {
  retainedEvents: number;
  graphEvents: number;
  oldestEventAt?: number;
  newestEventAt?: number;
}

export interface AgentGraphProviderCoverage {
  agents: number;
  agentsWithEvents: number;
  retainedEvents: number;
  history: GraphHistoryStatus;
  note?: string;
}

export interface AgentGraphCoverage {
  providers: Record<string, AgentGraphProviderCoverage>;
}

export interface AgentGraphStats {
  agents: number;
  steps: number;
  edges: number;
  transitionEdges: number;
  transitions: number;
  loops: number;
  activeLoops: number;
  errorLoops: number;
}

export interface AgentGraphSnapshot {
  version: 1;
  source: "observed-events";
  ts: number;
  window: AgentGraphWindow;
  coverage: AgentGraphCoverage;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  loops: AgentGraphLoop[];
  stats: AgentGraphStats;
}

export interface AgentGraphInput {
  source: AgentGraphSnapshot["source"];
  ts: number;
  window: AgentGraphWindow;
  coverage?: AgentGraphCoverage;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}
