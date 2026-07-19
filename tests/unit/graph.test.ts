import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAgentGraph,
  buildAgentGraph,
  formatAgentGraph,
  type AgentGraphNode,
} from "../../src/graph.js";
import type {
  AgentKind,
  AgentSnapshot,
  EventSummary,
  SnapshotPayload,
} from "../../src/types.js";

function event(
  ts: number,
  type: string,
  summary: string = type,
  isError = false,
  turnId?: string
): EventSummary {
  return {
    ts,
    type,
    summary,
    ...(isError ? { isError } : {}),
    ...(turnId ? { turnId } : {}),
  };
}

function agent(
  events: EventSummary[],
  state: AgentSnapshot["state"] = "active",
  identity = "codex:session-1",
  kind: AgentKind = "tui"
): AgentSnapshot {
  const second = identity.endsWith("2");
  return {
    identity,
    id: second ? "102" : "101",
    pid: second ? 102 : 101,
    title: second ? "second worker" : "graph worker",
    cmd: kind.startsWith("claude") ? "claude" : "codex",
    cmdShort: kind.startsWith("claude") ? "claude" : "codex",
    kind,
    cpu: 1,
    mem: 100,
    state,
    events,
  };
}

function snapshot(events: EventSummary[]): SnapshotPayload {
  return { ts: 1_000, agents: [agent(events)] };
}

describe("agent graph", () => {
  it("keeps live agents when no step events are retained", () => {
    const graph = buildAgentGraph(snapshot([]));

    assert.equal(graph.stats.agents, 1);
    assert.equal(graph.stats.steps, 0);
    assert.equal(graph.stats.loops, 0);
    assert.equal(graph.window.retainedEvents, 0);
    assert.equal(graph.window.graphEvents, 0);
    assert.equal(graph.coverage.providers.codex.history, "available");
  });

  it("normalizes provider events into model and tool phases", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "event_msg", "thinking"),
        event(2, "response_item", "tool: shell"),
        event(3, "event_msg", "message"),
        event(4, "response_item", "tool: shell"),
      ])
    );

    assert.equal(graph.stats.steps, 2);
    assert.equal(graph.stats.transitionEdges, 2);
    assert.equal(graph.stats.transitions, 3);
    assert.equal(graph.loops.length, 1);
    assert.equal(graph.loops[0].kind, "cycle");
    assert.equal(graph.loops[0].transitionObservations, 3);
    assert.deepEqual(
      graph.nodes
        .filter((node) => node.kind === "step")
        .map((node) => node.label)
        .sort(),
      ["model", "tool"]
    );
  });

  it("keeps tool execution events in the tool phase", () => {
    const graph = buildAgentGraph(
      snapshot([event(1, "tool_execution", "event: tool_execution")])
    );

    const step = graph.nodes.find((node) => node.kind === "step");
    assert.equal(step?.phase, "tool");
  });

  it("collapses adjacent stream fragments instead of reporting a false self loop", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "response.delta", "thinking"),
        event(2, "response.delta", "thinking"),
        event(3, "response.delta", "message"),
      ])
    );

    const step = graph.nodes.find((node) => node.kind === "step");
    assert.equal(graph.stats.steps, 1);
    assert.equal(graph.stats.transitionEdges, 0);
    assert.equal(graph.stats.loops, 0);
    assert.equal(step?.observations, 3);
  });

  it("detects an explicit self edge", () => {
    const node: AgentGraphNode = {
      id: "step:codex:abc:s1:tool",
      kind: "step",
      label: "tool",
      state: "active",
      agentKey: "codex:abc",
      provider: "codex",
      phase: "tool",
      segment: 1,
      current: true,
    };
    const graph = analyzeAgentGraph({
      source: "observed-events",
      ts: 1,
      window: { retainedEvents: 1, graphEvents: 1 },
      nodes: [node],
      edges: [
        {
          id: "transition:self",
          source: node.id,
          target: node.id,
          kind: "transition",
          observations: 2,
        },
      ],
    });

    assert.equal(graph.loops.length, 1);
    assert.equal(graph.loops[0].kind, "self");
    assert.equal(graph.loops[0].transitionObservations, 2);
  });

  it("does not report a one-way phase chain as a loop", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "prompt", "prompt: build"),
        event(2, "reasoning", "thinking"),
        event(3, "assistant", "message"),
      ])
    );

    assert.equal(graph.stats.transitionEdges, 1);
    assert.equal(graph.stats.loops, 0);
  });

  it("does not connect independent turns into a false loop", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "turn.started", "event: turn.started", false, "turn-1"),
        event(2, "user_message", "prompt: first", false, "turn-1"),
        event(3, "response_item", "thinking", false, "turn-1"),
        event(4, "turn.completed", "event: turn.completed", false, "turn-1"),
        event(5, "turn.started", "event: turn.started", false, "turn-2"),
        event(6, "user_message", "prompt: second", false, "turn-2"),
        event(7, "response_item", "message", false, "turn-2"),
      ])
    );

    assert.equal(graph.stats.loops, 0);
    assert.equal(graph.stats.steps, 4);
    assert.equal(graph.stats.transitionEdges, 2);
    assert.deepEqual(
      graph.nodes
        .filter((node) => node.kind === "step")
        .map((node) => node.segment)
        .sort(),
      [1, 1, 2, 2]
    );
  });

  it("uses prompt boundaries when a provider does not expose turn ids", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "prompt", "prompt: first"),
        event(2, "assistant", "message"),
        event(3, "prompt", "prompt: second"),
        event(4, "assistant", "message"),
      ])
    );

    assert.equal(graph.stats.loops, 0);
    assert.equal(graph.stats.steps, 4);
    assert.equal(graph.stats.transitionEdges, 2);
  });

  it("does not mark a completed historical loop active during a later phase", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "turn.started", "event: turn.started", false, "turn-1"),
        event(2, "response_item", "thinking", false, "turn-1"),
        event(3, "tool", "tool: shell", false, "turn-1"),
        event(4, "response_item", "message", false, "turn-1"),
        event(5, "turn.completed", "event: turn.completed", false, "turn-1"),
        event(6, "turn.started", "event: turn.started", false, "turn-2"),
        event(7, "prompt", "prompt: next", false, "turn-2"),
        event(8, "file_edit", "edit: src/index.ts", false, "turn-2"),
      ])
    );

    assert.equal(graph.stats.loops, 1);
    assert.equal(graph.loops[0].state, "idle");
    assert.equal(graph.stats.activeLoops, 0);
    assert.deepEqual(graph.loops[0].segments, [1]);
    const currentNode = graph.nodes.find(
      (node) => node.kind === "step" && node.current
    );
    assert.equal(currentNode?.phase, "edit");
    assert.equal(currentNode?.state, "active");
  });

  it("isolates equal phase names by agent identity and turn", () => {
    const graph = buildAgentGraph({
      ts: 1_000,
      agents: [
        agent([
          event(1, "tool", "tool: shell"),
          event(2, "message", "message"),
          event(3, "tool", "tool: shell"),
        ]),
        agent(
          [event(1, "tool", "tool: shell")],
          "idle",
          "codex:session-2"
        ),
      ],
    });

    assert.equal(graph.stats.agents, 2);
    assert.equal(graph.stats.steps, 3);
    assert.equal(graph.stats.loops, 1);
    assert.equal(graph.loops[0].agentKeys.length, 1);
  });

  it("does not expose raw or URL-encoded session identities", () => {
    const identity =
      "/Users/alice/.codex/sessions/2026/07/18/rollout-secret.jsonl";
    const graph = buildAgentGraph({
      ts: 1_000,
      agents: [agent([event(1, "assistant", "message")], "idle", identity)],
    });
    const json = JSON.stringify(graph);

    assert.equal(json.includes(identity), false);
    assert.equal(json.includes(encodeURIComponent(identity)), false);
    const agentNode = graph.nodes.find((node) => node.kind === "agent");
    assert.match(agentNode?.agentKey ?? "", /^codex:[a-f0-9]{20}$/);
  });

  it("marks Claude graph history unavailable when no retained events exist", () => {
    const graph = buildAgentGraph({
      ts: 1_000,
      agents: [
        agent([], "active", "claude:session-1", "claude-tui"),
      ],
    });

    assert.equal(graph.stats.agents, 1);
    assert.equal(graph.stats.steps, 0);
    assert.equal(graph.coverage.providers.claude.history, "unavailable");
    assert.match(
      graph.coverage.providers.claude.note ?? "",
      /No retained Claude hook events were available/i
    );
  });

  it("marks a current loop as error only when the current phase is in that loop", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "event_msg", "thinking"),
        event(2, "tool", "tool: shell"),
        event(3, "event_msg", "message"),
      ])
    );
    const current = graph.nodes.find(
      (node) => node.kind === "step" && node.current
    );
    if (current) current.state = "error";
    const analyzed = analyzeAgentGraph({
      source: graph.source,
      ts: graph.ts,
      window: graph.window,
      coverage: graph.coverage,
      nodes: graph.nodes,
      edges: graph.edges,
    });

    assert.equal(analyzed.loops[0].state, "error");
    assert.equal(analyzed.stats.errorLoops, 1);
  });

  it("renders coverage and explicit transition observation wording", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "event_msg", "thinking"),
        event(2, "tool", "tool: shell"),
        event(3, "event_msg", "message"),
      ])
    );
    const output = formatAgentGraph(graph);

    assert.match(output, /consensus graph/);
    assert.match(output, /agents=1 steps=2/);
    assert.match(output, /COVERAGE/);
    assert.match(output, /model -> tool -> model/);
    assert.match(output, /transition_observations=2/);
  });
});
