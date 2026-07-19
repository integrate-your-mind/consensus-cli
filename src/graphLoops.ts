import type { AgentState } from "./types.js";
import type {
  AgentGraphEdge,
  AgentGraphLoop,
  AgentGraphNode,
} from "./graphTypes.js";

function stateRank(state: AgentState): number {
  if (state === "error") return 2;
  if (state === "active") return 1;
  return 0;
}

function strongestState(states: Iterable<AgentState>): AgentState {
  let strongest: AgentState = "idle";
  for (const state of states) {
    if (stateRank(state) > stateRank(strongest)) strongest = state;
  }
  return strongest;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  let max: number | undefined;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    max = typeof max === "number" ? Math.max(max, value) : value;
  }
  return max;
}

function sortedAdjacency(
  nodeIds: string[],
  edges: AgentGraphEdge[],
  reverse = false
): Map<string, string[]> {
  const targetSets = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) targetSets.set(nodeId, new Set());

  for (const edge of edges) {
    const source = reverse ? edge.target : edge.source;
    const target = reverse ? edge.source : edge.target;
    const targets = targetSets.get(source);
    if (!targets || !targetSets.has(target)) continue;
    targets.add(target);
  }

  return new Map(
    [...targetSets.entries()].map(([nodeId, targets]) => [
      nodeId,
      [...targets].sort(),
    ])
  );
}

function findStronglyConnectedComponents(
  nodeIds: string[],
  edges: AgentGraphEdge[]
): string[][] {
  const uniqueNodeIds = [...new Set(nodeIds)].sort();
  const adjacency = sortedAdjacency(uniqueNodeIds, edges);
  const reverseAdjacency = sortedAdjacency(uniqueNodeIds, edges, true);
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  for (const startNodeId of uniqueNodeIds) {
    if (visited.has(startNodeId)) continue;
    visited.add(startNodeId);
    const stack: Array<{ nodeId: string; nextTargetIndex: number }> = [
      { nodeId: startNodeId, nextTargetIndex: 0 },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const targets = adjacency.get(frame.nodeId) ?? [];
      if (frame.nextTargetIndex < targets.length) {
        const target = targets[frame.nextTargetIndex];
        frame.nextTargetIndex += 1;
        if (!visited.has(target)) {
          visited.add(target);
          stack.push({ nodeId: target, nextTargetIndex: 0 });
        }
        continue;
      }

      stack.pop();
      finishOrder.push(frame.nodeId);
    }
  }

  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const startNodeId = finishOrder[index];
    if (assigned.has(startNodeId)) continue;

    const component: string[] = [];
    const stack = [startNodeId];
    assigned.add(startNodeId);
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId) continue;
      component.push(nodeId);
      for (const target of reverseAdjacency.get(nodeId) ?? []) {
        if (assigned.has(target)) continue;
        assigned.add(target);
        stack.push(target);
      }
    }
    component.sort();
    components.push(component);
  }

  return components.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

function isTurnScopedTransition(
  edge: AgentGraphEdge,
  stepNodeById: Map<string, AgentGraphNode>
): boolean {
  if (edge.kind !== "transition") return false;
  const source = stepNodeById.get(edge.source);
  const target = stepNodeById.get(edge.target);
  if (!source || !target) return false;
  return (
    source.agentKey === target.agentKey &&
    source.provider === target.provider &&
    typeof source.segment === "number" &&
    source.segment === target.segment
  );
}

export function detectGraphLoops(
  nodes: AgentGraphNode[],
  edges: AgentGraphEdge[]
): AgentGraphLoop[] {
  const stepNodes = nodes.filter((node) => node.kind === "step");
  const stepNodeById = new Map(stepNodes.map((node) => [node.id, node]));
  const transitionEdges = edges.filter((edge) =>
    isTurnScopedTransition(edge, stepNodeById)
  );
  const selfLoopNodeIds = new Set(
    transitionEdges
      .filter((edge) => edge.source === edge.target)
      .map((edge) => edge.source)
  );
  const components = findStronglyConnectedComponents(
    [...stepNodeById.keys()],
    transitionEdges
  );

  const loops: AgentGraphLoop[] = [];
  for (const component of components) {
    const isSelfLoop = component.length === 1 && selfLoopNodeIds.has(component[0]);
    if (component.length < 2 && !isSelfLoop) continue;

    const memberIds = new Set(component);
    const loopEdges = transitionEdges.filter(
      (edge) => memberIds.has(edge.source) && memberIds.has(edge.target)
    );
    const memberNodes = component
      .map((nodeId) => stepNodeById.get(nodeId))
      .filter((node): node is AgentGraphNode => !!node);
    const currentMemberNodes = memberNodes.filter((node) => node.current);

    loops.push({
      id: `loop:${component.join("|")}`,
      kind: isSelfLoop ? "self" : "cycle",
      nodeIds: component,
      edgeIds: loopEdges.map((edge) => edge.id).sort(),
      agentKeys: Array.from(
        new Set(memberNodes.map((node) => node.agentKey))
      ).sort(),
      providers: Array.from(
        new Set(memberNodes.map((node) => node.provider))
      ).sort(),
      segments: Array.from(
        new Set(
          memberNodes
            .map((node) => node.segment)
            .filter((segment): segment is number => typeof segment === "number")
        )
      ).sort((a, b) => a - b),
      state: strongestState(currentMemberNodes.map((node) => node.state)),
      transitionObservations: loopEdges.reduce(
        (total, edge) => total + edge.observations,
        0
      ),
      lastSeenAt: maxDefined(loopEdges.map((edge) => edge.lastSeenAt)),
    });
  }

  return loops.sort((a, b) => a.id.localeCompare(b.id));
}
