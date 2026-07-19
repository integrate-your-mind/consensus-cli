import { createHash } from "node:crypto";
import {
  harnessCoverageNote,
  harnessDefinitions,
  harnessIdForKind,
} from "./harnesses.js";
import type {
  AgentKind,
  AgentSnapshot,
  AgentState,
  EventSummary,
  SnapshotPayload,
} from "./types.js";
import { detectGraphLoops } from "./graphLoops.js";
import type {
  AgentGraphCoverage,
  AgentGraphEdge,
  AgentGraphInput,
  AgentGraphLoop,
  AgentGraphNode,
  AgentGraphProviderCoverage,
  AgentGraphSnapshot,
  GraphEdgeKind,
  GraphHistoryStatus,
} from "./graphTypes.js";

export type {
  AgentGraphCoverage,
  AgentGraphEdge,
  AgentGraphInput,
  AgentGraphLoop,
  AgentGraphNode,
  AgentGraphProviderCoverage,
  AgentGraphSnapshot,
  AgentGraphStats,
  AgentGraphWindow,
  GraphEdgeKind,
  GraphHistoryStatus,
  GraphLoopKind,
  GraphNodeKind,
} from "./graphTypes.js";

interface IndexedEvent {
  event: EventSummary;
  index: number;
}

const LIFECYCLE_OR_META_TYPES = new Set([
  "agentturncomplete",
  "sessionstart",
  "sessionend",
  "setup",
  "stop",
  "stopfailure",
  "userpromptexpansion",
  "precompact",
  "postcompact",
  "notification",
  "instructionsloaded",
  "configchange",
  "cwdchanged",
  "filechanged",
  "worktreecreate",
  "worktreeremove",
  "teammateidle",
  "serverconnected",
  "serverdisconnected",
  "heartbeat",
  "connected",
  "ready",
  "ping",
  "pong",
  "snapshot",
  "history",
  "tokencount",
]);
const GRAPH_TEXT_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const MAX_GRAPH_LABEL_LENGTH = 240;

function identityForAgent(agent: AgentSnapshot): string {
  return agent.identity || agent.id;
}

function providerForKind(kind: AgentKind): string {
  return harnessIdForKind(kind);
}

function opaqueAgentKey(provider: string, identity: string): string {
  const digest = createHash("sha256")
    .update(provider)
    .update("\0")
    .update(identity)
    .digest("hex")
    .slice(0, 20);
  return `${provider}:${digest}`;
}

function graphText(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.replace(GRAPH_TEXT_CONTROL_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_GRAPH_LABEL_LENGTH);
  return normalized || fallback;
}

function optionalGraphText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = graphText(value, "");
  return normalized || undefined;
}

function idPart(value: string): string {
  return encodeURIComponent(value);
}

function agentNodeId(agentKey: string): string {
  return `agent:${agentKey}`;
}

function stepNodeId(agentKey: string, segment: number, phase: string): string {
  return `step:${agentKey}:s${segment}:${idPart(phase)}`;
}

function edgeId(kind: GraphEdgeKind, source: string, target: string): string {
  return `${kind}:${source}->${target}`;
}

function normalizedEventType(event: EventSummary): string {
  const type = event.type?.trim();
  return type || "event";
}

function normalizedSummary(event: EventSummary): string {
  return event.summary?.trim().toLowerCase() || "";
}

function compactEventName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isLifecycleOrMetaEvent(event: EventSummary): boolean {
  const eventType = normalizedEventType(event).toLowerCase();
  const compact = compactEventName(eventType);
  const summary = normalizedSummary(event);

  if (
    /^(thread|turn|response|run|session)\.(started|start|in_progress|running|completed|complete|failed|failure|errored|error|canceled|cancelled|aborted|interrupted|stopped|stop|idle|status|created|updated|ended|end)$/.test(
      eventType
    )
  ) {
    return true;
  }

  if (LIFECYCLE_OR_META_TYPES.has(compact)) return true;

  return (
    summary.startsWith("event:") &&
    /(heartbeat|connected|ready|snapshot|history|token_count|compaction)/.test(
      `${eventType} ${summary}`
    )
  );
}

function phaseForEvent(event: EventSummary): string | undefined {
  if (isLifecycleOrMetaEvent(event)) return undefined;

  const summary = normalizedSummary(event);
  const eventType = normalizedEventType(event);
  const lowerType = eventType.toLowerCase();
  const compact = compactEventName(eventType);

  if (summary.startsWith("cmd:")) return "command";
  if (summary.startsWith("edit:")) return "edit";
  if (summary.startsWith("tool:")) return "tool";
  if (summary.startsWith("prompt:")) return "prompt";
  if (/file_(change|edit|write)|patch/.test(lowerType)) return "edit";
  if (/tool|function_call|mcp|permission|subagent|task/.test(lowerType)) {
    return "tool";
  }
  if (/command|(?:^|[._-])exec(?:ute|ution)?(?:[._-]|$)/.test(lowerType)) {
    return "command";
  }
  if (/prompt|user_message/.test(lowerType) || compact === "userpromptsubmit") {
    return "prompt";
  }
  if (
    summary === "thinking" ||
    summary === "message" ||
    compact === "messagedisplay" ||
    /reasoning|assistant|agent_message|message\.part\.updated|response\..*delta/.test(
      lowerType
    )
  ) {
    return "model";
  }
  if (summary && !summary.startsWith("event:") && !summary.startsWith("compaction:")) {
    return "model";
  }
  return graphText(eventType, "event");
}

function isTurnStartEvent(event: EventSummary): boolean {
  const type = normalizedEventType(event).toLowerCase();
  const compact = compactEventName(type);
  return (
    /^(turn|run)\.(started|start)$/.test(type) ||
    compact === "userpromptsubmit"
  );
}

function isTurnEndEvent(event: EventSummary): boolean {
  const type = normalizedEventType(event).toLowerCase();
  const compact = compactEventName(type);
  return (
    /^(turn|response|run)\.(completed|complete|failed|failure|errored|error|canceled|cancelled|aborted|interrupted|stopped|stop|ended|end)$/.test(
      type
    ) ||
    type === "session.idle" ||
    compact === "agentturncomplete" ||
    compact === "stop" ||
    compact === "stopfailure" ||
    compact === "sessionend"
  );
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

function historyStatusForProvider(
  provider: string,
  agents: number,
  agentsWithEvents: number
): { history: GraphHistoryStatus; note?: string } {
  if (agentsWithEvents === agents && agents > 0) {
    return { history: "available" };
  }
  if (agentsWithEvents > 0) {
    return {
      history: "partial",
      note: "Only some observed agents included retained events.",
    };
  }
  if (provider === "codex" || provider === "opencode") {
    return {
      history: "available",
      note: "No retained graph events were present in this snapshot window.",
    };
  }

  const harness = harnessDefinitions.find((candidate) => candidate.id === provider);
  if (harness) {
    return {
      history: "unavailable",
      note: harnessCoverageNote(harness, false),
    };
  }

  return {
    history: "unavailable",
    note: "This harness does not expose retained graph events in the current adapter.",
  };
}

function normalizeCoverage(
  coverage: Map<
    string,
    { agents: number; agentsWithEvents: number; retainedEvents: number }
  >
): AgentGraphCoverage {
  const providers: Record<string, AgentGraphProviderCoverage> = {};
  for (const provider of [...coverage.keys()].sort()) {
    const current = coverage.get(provider);
    if (!current) continue;
    const status = historyStatusForProvider(
      provider,
      current.agents,
      current.agentsWithEvents
    );
    providers[provider] = {
      ...current,
      ...status,
    };
  }
  return { providers };
}

function deriveCoverageFromNodes(nodes: AgentGraphNode[]): AgentGraphCoverage {
  const coverage = new Map<
    string,
    { agents: number; agentsWithEvents: number; retainedEvents: number }
  >();
  const agentKeysByProvider = new Map<string, Set<string>>();
  const eventAgentsByProvider = new Map<string, Set<string>>();
  for (const node of nodes) {
    const agentSet = agentKeysByProvider.get(node.provider) ?? new Set<string>();
    agentSet.add(node.agentKey);
    agentKeysByProvider.set(node.provider, agentSet);
    if (node.kind === "step") {
      const eventSet =
        eventAgentsByProvider.get(node.provider) ?? new Set<string>();
      eventSet.add(node.agentKey);
      eventAgentsByProvider.set(node.provider, eventSet);
    }
  }
  for (const [provider, agentKeys] of agentKeysByProvider) {
    coverage.set(provider, {
      agents: agentKeys.size,
      agentsWithEvents: eventAgentsByProvider.get(provider)?.size ?? 0,
      retainedEvents: nodes
        .filter((node) => node.provider === provider && node.kind === "step")
        .reduce((total, node) => total + (node.observations ?? 0), 0),
    });
  }
  return normalizeCoverage(coverage);
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
    coverage: input.coverage ?? deriveCoverageFromNodes(nodes),
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
  let graphEvents = 0;
  const coverage = new Map<
    string,
    { agents: number; agentsWithEvents: number; retainedEvents: number }
  >();
  const agents = [...snapshot.agents].sort((a, b) =>
    identityForAgent(a).localeCompare(identityForAgent(b))
  );

  for (const agent of agents) {
    const identity = identityForAgent(agent);
    const provider = providerForKind(agent.kind);
    const agentKey = opaqueAgentKey(provider, identity);
    const rootNodeId = agentNodeId(agentKey);
    const events = sortedEvents(agent.events);
    const providerCoverage = coverage.get(provider) ?? {
      agents: 0,
      agentsWithEvents: 0,
      retainedEvents: 0,
    };
    providerCoverage.agents += 1;
    providerCoverage.retainedEvents += events.length;
    if (events.length > 0) providerCoverage.agentsWithEvents += 1;
    coverage.set(provider, providerCoverage);

    nodes.set(rootNodeId, {
      id: rootNodeId,
      kind: "agent",
      label: graphText(agent.title || agent.doing, `${provider} agent`),
      state: agent.state,
      agentKey,
      provider,
      repo: optionalGraphText(agent.repo),
      firstSeenAt:
        typeof agent.startedAt === "number" ? agent.startedAt * 1000 : undefined,
      lastSeenAt: maxDefined([agent.lastActivityAt, agent.lastEventAt, snapshot.ts]),
      observations: 1,
    });

    let segmentCounter = 0;
    let activeSegment: number | undefined;
    let activeTurnId: string | undefined;
    let previousStepNodeId: string | undefined;
    let segmentHasPhase = false;
    let latestStepNodeId: string | undefined;

    const startSegment = (turnId?: string): number => {
      segmentCounter += 1;
      activeSegment = segmentCounter;
      activeTurnId = turnId;
      previousStepNodeId = undefined;
      segmentHasPhase = false;
      latestStepNodeId = undefined;
      return activeSegment;
    };

    const closeSegment = (): void => {
      activeSegment = undefined;
      activeTurnId = undefined;
      previousStepNodeId = undefined;
      segmentHasPhase = false;
    };

    for (const event of events) {
      retainedEventTimes.push(event.ts);
      const phase = phaseForEvent(event);
      const turnId =
        typeof event.turnId === "number"
          ? String(event.turnId)
          : event.turnId?.trim() || undefined;
      const turnStart = isTurnStartEvent(event);
      const turnEnd = isTurnEndEvent(event);

      if (turnId) {
        if (activeSegment === undefined || activeTurnId !== turnId) {
          startSegment(turnId);
        }
      } else if (
        phase === "prompt" &&
        (activeSegment === undefined || segmentHasPhase)
      ) {
        startSegment();
      } else if (turnStart && activeSegment === undefined) {
        startSegment();
      } else if (phase && activeSegment === undefined) {
        startSegment();
      }

      if (phase && activeSegment !== undefined) {
        graphEvents += 1;
        const currentStepNodeId = stepNodeId(agentKey, activeSegment, phase);
        const current = nodes.get(currentStepNodeId);

        if (current) {
          current.observations = (current.observations ?? 0) + 1;
          current.firstSeenAt = Math.min(current.firstSeenAt ?? event.ts, event.ts);
          current.lastSeenAt = Math.max(current.lastSeenAt ?? event.ts, event.ts);
          current.eventTypes = Array.from(
            new Set([...(current.eventTypes ?? []), normalizedEventType(event)])
          ).sort();
          if (event.isError) current.hadError = true;
        } else {
          nodes.set(currentStepNodeId, {
            id: currentStepNodeId,
            kind: "step",
            label: phase,
            state: "idle",
            agentKey,
            provider,
            repo: optionalGraphText(agent.repo),
            phase,
            segment: activeSegment,
            hadError: !!event.isError,
            eventTypes: [normalizedEventType(event)],
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
        latestStepNodeId = currentStepNodeId;
        segmentHasPhase = true;
      }

      if (turnEnd) closeSegment();
    }

    if (latestStepNodeId) {
      const latest = nodes.get(latestStepNodeId);
      if (latest) {
        latest.current = true;
        latest.state = agent.state;
      }
    }
  }

  return analyzeAgentGraph({
    source: "observed-events",
    ts: snapshot.ts,
    window: {
      retainedEvents: retainedEventTimes.length,
      graphEvents,
      oldestEventAt: minDefined(retainedEventTimes),
      newestEventAt: maxDefined(retainedEventTimes),
    },
    coverage: normalizeCoverage(coverage),
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  });
}

function graphStateLabel(state: AgentState): string {
  return state.toUpperCase().padEnd(6, " ");
}

function formatLoop(
  loop: AgentGraphLoop,
  nodeById: Map<string, AgentGraphNode>
): string {
  const labels = loop.nodeIds.map(
    (nodeId) => nodeById.get(nodeId)?.label || nodeId
  );
  const path =
    loop.kind === "self"
      ? `${labels[0]} -> ${labels[0]}`
      : labels.length === 2
        ? `${labels[0]} -> ${labels[1]} -> ${labels[0]}`
        : `cycle{${labels.join(", ")}}`;
  const segmentLabel =
    loop.segments.length === 1
      ? `segment=${loop.segments[0]}`
      : `segments=${loop.segments.join(",")}`;
  return `${path} ${segmentLabel}`;
}

export function formatAgentGraph(graph: AgentGraphSnapshot): string {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const agentNodes = graph.nodes.filter((node) => node.kind === "agent");
  const stepCountByAgent = new Map<string, number>();
  const loopCountByAgent = new Map<string, number>();

  for (const node of graph.nodes) {
    if (node.kind !== "step") continue;
    stepCountByAgent.set(
      node.agentKey,
      (stepCountByAgent.get(node.agentKey) ?? 0) + 1
    );
  }
  for (const loop of graph.loops) {
    for (const agentKey of loop.agentKeys) {
      loopCountByAgent.set(
        agentKey,
        (loopCountByAgent.get(agentKey) ?? 0) + 1
      );
    }
  }

  const lines = [
    "consensus graph",
    `agents=${graph.stats.agents} steps=${graph.stats.steps} ` +
      `transition_edges=${graph.stats.transitionEdges} transitions=${graph.stats.transitions} ` +
      `loops=${graph.stats.loops} window_events=${graph.window.retainedEvents} ` +
      `graph_events=${graph.window.graphEvents}`,
    "",
    "COVERAGE",
  ];

  const coverageEntries = Object.entries(graph.coverage.providers);
  if (coverageEntries.length === 0) {
    lines.push("  none observed");
  } else {
    for (const [provider, coverage] of coverageEntries) {
      const suffix = coverage.note ? ` — ${coverage.note}` : "";
      lines.push(
        `  ${provider} history=${coverage.history} agents=${coverage.agents} ` +
          `agents_with_events=${coverage.agentsWithEvents} events=${coverage.retainedEvents}${suffix}`
      );
    }
  }

  lines.push("", "AGENTS");
  if (agentNodes.length === 0) {
    lines.push("  none observed");
  } else {
    for (const node of agentNodes) {
      const steps = stepCountByAgent.get(node.agentKey) ?? 0;
      const loops = loopCountByAgent.get(node.agentKey) ?? 0;
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
          `transition_observations=${loop.transitionObservations}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
