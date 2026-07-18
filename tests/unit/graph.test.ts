import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAgentGraph,
  buildAgentGraph,
  formatAgentGraph,
  type AgentGraphNode,
} from "../../src/graph.js";
import type { AgentSnapshot, EventSummary, SnapshotPayload } from "../../src/types.js";

function event(
  ts: number,
  type: string,
  summary: string = type,
  isError = false
): EventSummary {
  return { ts, type, summary, ...(isError ? { isError } : {}) };
}

function agent(
  events: EventSummary[],
  state: AgentSnapshot["state"] = "active",
  identity = "codex:session-1"
): AgentSnapshot {
  const second = identity.endsWith("2");
  return {
    identity,
    id: second ? "102" : "101",
    pid: second ? 102 : 101,
    title: second ? "second worker" : "graph worker",
    cmd: "codex",
    cmdShort: "codex",
    kind: "tui",
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
    assert.equal(graph.loops[0].observations, 3);
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
      id: "step:x:tool",
      kind: "step",
      label: "tool",
      state: "active",
      agentId: "1",
      agentIdentity: "x",
      provider: "codex",
      phase: "tool",
    };
    const graph = analyzeAgentGraph({
      source: "observed-events",
      ts: 1,
      window: { retainedEvents: 1 },
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
    assert.equal(graph.loops[0].observations, 2);
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

  it("isolates equal phase names by agent identity", () => {
    const graph = buildAgentGraph({
      ts: 1_000,
      agents: [
        agent([
          event(1, "tool", "tool: shell"),
          event(2, "message", "message"),
          event(3, "tool", "tool: shell"),
        ]),
        agent([event(1, "tool", "tool: shell")], "idle", "codex:session-2"),
      ],
    });

    assert.equal(graph.stats.agents, 2);
    assert.equal(graph.stats.steps, 3);
    assert.equal(graph.stats.loops, 1);
    assert.deepEqual(graph.loops[0].agentIds, ["codex:session-1"]);
  });

  it("marks a loop as error when one phase has an error event", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "event_msg", "thinking"),
        event(2, "tool", "tool: shell", true),
        event(3, "event_msg", "message"),
      ])
    );

    assert.equal(graph.loops[0].state, "error");
    assert.equal(graph.stats.errorLoops, 1);
  });

  it("renders a compact human-readable summary", () => {
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
    assert.match(output, /model -> tool -> model/);
  });
});
