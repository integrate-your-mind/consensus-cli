import type { ConsensusGraph, GraphAnalysis } from "./types.js";

function buildAdjacency(graph: ConsensusGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }
  return adjacency;
}

function canReach(
  adjacency: ReadonlyMap<string, readonly string[]>,
  start: string,
  target: string,
): boolean {
  if (start === target) return true;

  const visited = new Set<string>();
  const pending = [start];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    for (const next of adjacency.get(current) ?? []) {
      if (next === target) return true;
      if (!visited.has(next)) pending.push(next);
    }
  }

  return false;
}

export function analyzeGraph(graph: ConsensusGraph): GraphAnalysis {
  const adjacency = buildAdjacency(graph);
  const reachable = new Set<string>();
  const pending = [graph.entry];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) pending.push(next);
    }
  }

  const cyclicEdges = graph.edges.flatMap((edge, index) => {
    const isCyclic = edge.from === edge.to || canReach(adjacency, edge.to, edge.from);
    return isCyclic
      ? [{ index, from: edge.from, to: edge.to, maxTraversals: edge.maxTraversals }]
      : [];
  });

  const terminalNodeIds = graph.nodes
    .filter((node) => (adjacency.get(node.id)?.length ?? 0) === 0)
    .map((node) => node.id)
    .sort();

  const reachableNodeIds = [...reachable].sort();
  const unreachableNodeIds = graph.nodes
    .map((node) => node.id)
    .filter((nodeId) => !reachable.has(nodeId))
    .sort();

  return {
    reachableNodeIds,
    unreachableNodeIds,
    terminalNodeIds,
    cyclicEdges,
    hasCycles: cyclicEdges.length > 0,
  };
}
