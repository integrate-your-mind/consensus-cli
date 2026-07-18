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

function findStronglyConnectedComponents(
  nodeIds: string[],
  edges: AgentGraphEdge[]
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, []);
  for (const edge of edges) {
    if (edge.kind !== "transition") continue;
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
  }
  for (const targets of adjacency.values()) targets.sort();

  let nextIndex = 0;
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (nodeId: string): void => {
    indexByNode.set(nodeId, nextIndex);
    lowLinkByNode.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const target of adjacency.get(nodeId) ?? []) {
      if (!indexByNode.has(target)) {
        visit(target);
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId) ?? 0, lowLinkByNode.get(target) ?? 0)
        );
      } else if (onStack.has(target)) {
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId) ?? 0, indexByNode.get(target) ?? 0)
        );
      }
    }

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) return;

    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
      if (member === nodeId) break;
    }
    component.sort();
    components.push(component);
  };

  for (const nodeId of [...nodeIds].sort()) {
    if (!indexByNode.has(nodeId)) visit(nodeId);
  }

  return components;
}

export function detectGraphLoops(
  nodes: AgentGraphNode[],
  edges: AgentGraphEdge[]
): AgentGraphLoop[] {
  const stepNodes = nodes.filter((node) => node.kind === "step");
  const stepNodeById = new Map(stepNodes.map((node) => [node.id, node]));
  const transitionEdges = edges.filter((edge) => edge.kind === "transition");
  const selfLoopNodeIds = new Set(
    transitionEdges
      .filter((edge) => edge.source === edge.target)
      .map((edge) => edge.source)
  );
  const components = findStronglyConnectedComponents(
    stepNodes.map((node) => node.id),
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

    loops.push({
      id: `loop:${component.join("|")}`,
      kind: isSelfLoop ? "self" : "cycle",
      nodeIds: component,
      edgeIds: loopEdges.map((edge) => edge.id).sort(),
      agentIds: Array.from(
        new Set(memberNodes.map((node) => node.agentIdentity))
      ).sort(),
      providers: Array.from(
        new Set(memberNodes.map((node) => node.provider))
      ).sort(),
      state: strongestState(memberNodes.map((node) => node.state)),
      observations: loopEdges.reduce(
        (total, edge) => total + edge.observations,
        0
      ),
      lastSeenAt: maxDefined(loopEdges.map((edge) => edge.lastSeenAt)),
    });
  }

  return loops.sort((a, b) => a.id.localeCompare(b.id));
}
