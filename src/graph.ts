import type {
  AgentKind,
  AgentSnapshot,
  AgentState,
  EventSummary,
  SnapshotPayload,
} from "./types.js";
import { detectGraphLoops } from "./graphLoops.js";
import type {
  AgentGraphEdge,
  AgentGraphInput,
  AgentGraphLoop,
  AgentGraphNode,
  AgentGraphSnapshot,
  GraphEdgeKind,
} from "./graphTypes.js";

export type {
  AgentGraphEdge,
  AgentGraphInput,
  AgentGraphLoop,
  AgentGraphNode,
  AgentGraphSnapshot,
  AgentGraphStats,
  AgentGraphWindow,
  GraphEdgeKind,
  GraphLoopKind,
  GraphNodeKind,
} from "./graphTypes.js";

interface IndexedEvent {
  event: EventSummary;
  index: number;
}

function identityForAgent(agent: AgentSnapshot): string {
  return agent.identity || agent.id;
}

function providerForKind(kind: AgentKind): string {
  if (kind.startsWith("opencode")) return "opencode";
  if (kind.startsWith("claude")) return "claude";
  if (kind === "app-server") return "server";
  if (kind === "unknown") return "other";
  return "codex";
}

function idPart(value: string): string {
  return encodeURIComponent(value);
}

function agentNodeId(identity: string): string {
  return `agent:${idPart(identity)}`;
}

function stepNodeId(identity: string, phase: string): string {
  return `step:${idPart(identity)}:${idPart(phase)}`;
}

function edgeId(kind: GraphEdgeKind, source: string, target: string): string {
  return `${kind}:${source}->${target}`;
}

function normalizedEventType(event: EventSummary): string {
  const type = event.type?.trim();
  return type || "event";
}

function phaseForEvent(event: EventSummary): string {
  const summary = event.summary?.trim().toLowerCase() || "";
  const eventType = normalizedEventType(event);
  const lowerType = eventType.toLowerCase();

  if (summary.startsWith("cmd:")) return "command";
  if (summary.startsWith("edit:")) return "edit";
  if (summary.startsWith("tool:")) return "tool";
  if (summary.startsWith("prompt:")) return "prompt";
  if (/file_(change|edit|write)|patch/.test(lowerType)) return "edit";
  if (/tool|function_call|mcp/.test(lowerType)) return "tool";
  if (/command|(?:^|[._-])exec(?:ute|ution)?(?:[._-]|$)/.test(lowerType)) {
    return "command";
  }
  if (/prompt|user_message/.test(lowerType)) return "prompt";
  if (
    summary === "thinking" ||
    summary === "message" ||
    /reasoning|assistant|agent_message|response/.test(lowerType)
  ) {
    return "model";
  }
  if (summary && !summary.startsWith("event:") && !summary.startsWith("compaction:")) {
    return "model";
  }
  return eventType;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  let max: number | undefined;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    max = typeof max === "number" ? Math.max(max, value) : value;
  }
  return max;
}

function minDefined(values: Array<number | undefined>): number | undefined {
  let min: number | undefined;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    min = typeof min === "number" ? Math.min(min, value) : value;
  }
  return min;
}

function sortedEvents(events: EventSummary[] | undefined): EventSummary[] {
  if (!events?.length) return [];
  return events
    .map((event, index): IndexedEvent => ({ event, index }))
    .filter(({ event }) => typeof event.ts === "number" && Number.isFinite(event.ts))
    .sort((a, b) => a.event.ts - b.event.ts || a.index - b.index)
    .map(({ event }) => event);
}

function addContainsEdge(
  edges: Map<string, AgentGraphEdge>,
  source: string,
  target: string,
  lastSeenAt: number | undefined
): void {
  const id = edgeId("contains", source, target);
  const current = edges.get(id);
  if (current) {
    current.lastSeenAt = maxDefined([current.lastSeenAt, lastSeenAt]);
    return;
  }
  edges.set(id, {
    id,
    source,
    target,
    kind: "contains",
    observations: 1,
    lastSeenAt,
  });
}

function addTransitionEdge(
  edges: Map<string, AgentGraphEdge>,
  source: string,
  target: string,
  lastSeenAt: number
): void {
  const id = edgeId("transition", source, target);
  const current = edges.get(id);
  if (current) {
    current.observations += 1;
    current.lastSeenAt = Math.max(current.lastSeenAt ?? lastSeenAt, lastSeenAt);
    return;
  }
  edges.set(id, {
    id,
    source,
    target,
    kind: "transition",
    observations: 1,
    lastSeenAt,
  });
}

export function analyzeAgentGraph(input: AgentGraphInput): AgentGraphSnapshot {
  const nodes = [...input.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...input.edges].sort((a, b) => a.id.localeCompare(b.id));
  const loops = detectGraphLoops(nodes, edges);
  const transitionEdges = edges.filter((edge) => edge.kind === "transition");

  return {
    version: 1,
    source: input.source,
    ts: input.ts,
    window: input.window,
    nodes,
    edges,
    loops,
    stats: {
      agents: nodes.filter((node) => node.kind === "agent").length,
      steps: nodes.filter((node) => node.kind === "step").length,
      edges: edges.length,
      transitionEdges: transitionEdges.length,
      transitions: transitionEdges.reduce(
        (total, edge) => total + edge.observations,
        0
      ),
      loops: loops.length,
      activeLoops: loops.filter((loop) => loop.state === "active").length,
      errorLoops: loops.filter((loop) => loop.state === "error").length,
    },
  };
}

export function buildAgentGraph(snapshot: SnapshotPayload): AgentGraphSnapshot {
  const nodes = new Map<string, AgentGraphNode>();
  const edges = new Map<string, AgentGraphEdge>();
  const retainedEventTimes: number[] = [];
  const agents = [...snapshot.agents].sort((a, b) =>
    identityForAgent(a).localeCompare(identityForAgent(b))
  );

  for (const agent of agents) {
    const identity = identityForAgent(agent);
    const provider = providerForKind(agent.kind);
    const rootNodeId = agentNodeId(identity);
    nodes.set(rootNodeId, {
      id: rootNodeId,
      kind: "agent",
      label: agent.title || agent.doing || `${provider}:${agent.id}`,
      state: agent.state,
      agentId: agent.id,
      agentIdentity: identity,
      provider,
      repo: agent.repo,
      firstSeenAt:
        typeof agent.startedAt === "number" ? agent.startedAt * 1000 : undefined,
      lastSeenAt: maxDefined([agent.lastActivityAt, agent.lastEventAt, snapshot.ts]),
      observations: 1,
    });

    let previousStepNodeId: string | undefined;
    for (const event of sortedEvents(agent.events)) {
      retainedEventTimes.push(event.ts);
      const eventType = normalizedEventType(event);
      const phase = phaseForEvent(event);
      const currentStepNodeId = stepNodeId(identity, phase);
      const current = nodes.get(currentStepNodeId);

      if (current) {
        current.observations = (current.observations ?? 0) + 1;
        current.firstSeenAt = Math.min(current.firstSeenAt ?? event.ts, event.ts);
        current.lastSeenAt = Math.max(current.lastSeenAt ?? event.ts, event.ts);
        current.eventTypes = Array.from(
          new Set([...(current.eventTypes ?? []), eventType])
        ).sort();
        if (event.isError) current.state = "error";
      } else {
        nodes.set(currentStepNodeId, {
          id: currentStepNodeId,
          kind: "step",
          label: phase,
          state: event.isError ? "error" : agent.state,
          agentId: agent.id,
          agentIdentity: identity,
          provider,
          repo: agent.repo,
          phase,
          eventTypes: [eventType],
          firstSeenAt: event.ts,
          lastSeenAt: event.ts,
          observations: 1,
        });
      }

      addContainsEdge(edges, rootNodeId, currentStepNodeId, event.ts);
      if (previousStepNodeId && previousStepNodeId !== currentStepNodeId) {
        addTransitionEdge(edges, previousStepNodeId, currentStepNodeId, event.ts);
      }
      previousStepNodeId = currentStepNodeId;
    }
  }

  return analyzeAgentGraph({
    source: "observed-events",
    ts: snapshot.ts,
    window: {
      retainedEvents: retainedEventTimes.length,
      oldestEventAt: minDefined(retainedEventTimes),
      newestEventAt: maxDefined(retainedEventTimes),
    },
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  });
}

function graphStateLabel(state: AgentState): string {
  return state.toUpperCase().padEnd(6, " ");
}

function formatLoop(loop: AgentGraphLoop, nodeById: Map<string, AgentGraphNode>): string {
  const labels = loop.nodeIds.map(
    (nodeId) => nodeById.get(nodeId)?.label || nodeId
  );
  if (loop.kind === "self") return `${labels[0]} -> ${labels[0]}`;
  if (labels.length === 2) return `${labels[0]} -> ${labels[1]} -> ${labels[0]}`;
  return `cycle{${labels.join(", ")}}`;
}

export function formatAgentGraph(graph: AgentGraphSnapshot): string {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const agentNodes = graph.nodes.filter((node) => node.kind === "agent");
  const stepCountByAgent = new Map<string, number>();
  const loopCountByAgent = new Map<string, number>();

  for (const node of graph.nodes) {
    if (node.kind !== "step") continue;
    stepCountByAgent.set(
      node.agentIdentity,
      (stepCountByAgent.get(node.agentIdentity) ?? 0) + 1
    );
  }
  for (const loop of graph.loops) {
    for (const agentIdentity of loop.agentIds) {
      loopCountByAgent.set(
        agentIdentity,
        (loopCountByAgent.get(agentIdentity) ?? 0) + 1
      );
    }
  }

  const lines = [
    "consensus graph",
    `agents=${graph.stats.agents} steps=${graph.stats.steps} ` +
      `transition_edges=${graph.stats.transitionEdges} transitions=${graph.stats.transitions} ` +
      `loops=${graph.stats.loops} window_events=${graph.window.retainedEvents}`,
    "",
    "AGENTS",
  ];

  if (agentNodes.length === 0) {
    lines.push("  none observed");
  } else {
    for (const node of agentNodes) {
      const steps = stepCountByAgent.get(node.agentIdentity) ?? 0;
      const loops = loopCountByAgent.get(node.agentIdentity) ?? 0;
      lines.push(
        `  ${graphStateLabel(node.state)} ${node.label} ` +
          `[${node.provider}] steps=${steps} loops=${loops}`
      );
    }
  }

  lines.push("", "LOOPS");
  if (graph.loops.length === 0) {
    lines.push("  none detected in the retained event window");
  } else {
    for (const loop of graph.loops) {
      lines.push(
        `  ${graphStateLabel(loop.state)} ${formatLoop(loop, nodeById)} ` +
          `observations=${loop.observations}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
