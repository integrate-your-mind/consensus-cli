import type { AgentState } from "./types.js";

export type GraphNodeKind = "agent" | "step";
export type GraphEdgeKind = "contains" | "transition";
export type GraphLoopKind = "self" | "cycle";

export interface AgentGraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  state: AgentState;
  agentId: string;
  agentIdentity: string;
  provider: string;
  repo?: string;
  phase?: string;
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
  agentIds: string[];
  providers: string[];
  state: AgentState;
  observations: number;
  lastSeenAt?: number;
}

export interface AgentGraphWindow {
  retainedEvents: number;
  oldestEventAt?: number;
  newestEventAt?: number;
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
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  loops: AgentGraphLoop[];
  stats: AgentGraphStats;
}

export interface AgentGraphInput {
  source: AgentGraphSnapshot["source"];
  ts: number;
  window: AgentGraphWindow;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}
