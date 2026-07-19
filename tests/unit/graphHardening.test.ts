import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAgentGraph,
  buildAgentGraph,
  formatAgentGraph,
  type AgentGraphEdge,
  type AgentGraphNode,
} from "../../src/graph.js";
import type {
  AgentSnapshot,
  EventSummary,
  SnapshotPayload,
} from "../../src/types.js";

function event(
  ts: number,
  type: string,
  summary: string = type,
  turnId?: string
): EventSummary {
  return { ts, type, summary, ...(turnId ? { turnId } : {}) };
}

function snapshot(
  events: EventSummary[],
  overrides: Partial<AgentSnapshot> = {}
): SnapshotPayload {
  return {
    ts: 10_000,
    agents: [
      {
        identity: "codex:hardening-session",
        id: "901",
        pid: 901,
        cmd: "codex",
        cmdShort: "codex",
        kind: "tui",
        cpu: 0,
        mem: 100,
        state: "active",
        events,
        ...overrides,
      },
    ],
  };
}

function stepNode(
  id: string,
  agentKey: string,
  segment: number,
  phase: string
): AgentGraphNode {
  return {
    id,
    kind: "step",
    label: phase,
    state: "idle",
    agentKey,
    provider: "codex",
    segment,
    phase,
  };
}

function transition(
  id: string,
  source: string,
  target: string
): AgentGraphEdge {
  return {
    id,
    source,
    target,
    kind: "transition",
    observations: 1,
  };
}

describe("agent graph hardening", () => {
  it("does not reactivate a historical loop when a new turn starts without a phase", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "turn.started", "event: turn.started", "turn-1"),
        event(2, "response_item", "thinking", "turn-1"),
        event(3, "tool", "tool: shell", "turn-1"),
        event(4, "response_item", "message", "turn-1"),
        event(5, "turn.completed", "event: turn.completed", "turn-1"),
        event(6, "turn.started", "event: turn.started", "turn-2"),
      ])
    );

    assert.equal(graph.stats.loops, 1);
    assert.equal(graph.stats.activeLoops, 0);
    assert.equal(graph.loops[0].state, "idle");
    assert.equal(
      graph.nodes.some((node) => node.kind === "step" && node.current),
      false
    );
  });

  it("ignores UserPromptExpansion as activity metadata rather than a second prompt", () => {
    const graph = buildAgentGraph(
      snapshot(
        [
          event(1, "UserPromptSubmit", "prompt"),
          event(2, "MessageDisplay", "message"),
          event(3, "UserPromptExpansion", "prompt"),
          event(4, "PreToolUse", "tool: Bash"),
        ],
        { kind: "claude-tui", cmd: "claude", cmdShort: "claude" }
      )
    );

    const stepNodes = graph.nodes.filter((node) => node.kind === "step");
    assert.deepEqual(
      stepNodes.map((node) => node.phase).sort(),
      ["model", "prompt", "tool"]
    );
    assert.deepEqual(
      [...new Set(stepNodes.map((node) => node.segment))],
      [1]
    );
    assert.equal(
      stepNodes.filter((node) => node.phase === "prompt").length,
      1
    );
  });

  it("filters lifecycle events even when their summary looks like a prompt", () => {
    const graph = buildAgentGraph(
      snapshot([
        event(1, "turn.started", "prompt: forged"),
        event(2, "assistant_message", "message"),
      ])
    );

    const stepNodes = graph.nodes.filter((node) => node.kind === "step");
    assert.deepEqual(stepNodes.map((node) => node.phase), ["model"]);
    assert.equal(graph.window.graphEvents, 1);
  });

  it("sanitizes live labels and repository names before text or JSON export", () => {
    const graph = buildAgentGraph(
      snapshot([event(1, "assistant_message", "message")], {
        title: "worker\u001b[2J\u202Eevil",
        repo: "repo\nforged",
      })
    );
    const output = formatAgentGraph(graph);
    const json = JSON.stringify(graph);
    const forbidden = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

    assert.equal(forbidden.test(output), false);
    assert.equal(forbidden.test(json), false);
    assert.match(output, /worker evil/);
  });

  it("rejects cross-segment transitions as loop evidence", () => {
    const first = stepNode("step:a:s1:model", "codex:a", 1, "model");
    const second = stepNode("step:a:s2:tool", "codex:a", 2, "tool");
    const graph = analyzeAgentGraph({
      source: "observed-events",
      ts: 1,
      window: { retainedEvents: 2, graphEvents: 2 },
      nodes: [first, second],
      edges: [
        transition("cross-1", first.id, second.id),
        transition("cross-2", second.id, first.id),
      ],
    });

    assert.equal(graph.stats.loops, 0);
  });

  it("rejects cross-agent transitions as loop evidence", () => {
    const first = stepNode("step:a:s1:model", "codex:a", 1, "model");
    const second = stepNode("step:b:s1:tool", "codex:b", 1, "tool");
    const graph = analyzeAgentGraph({
      source: "observed-events",
      ts: 1,
      window: { retainedEvents: 2, graphEvents: 2 },
      nodes: [first, second],
      edges: [
        transition("cross-agent-1", first.id, second.id),
        transition("cross-agent-2", second.id, first.id),
      ],
    });

    assert.equal(graph.stats.loops, 0);
  });

  it("handles a deep acyclic graph without recursive stack overflow", () => {
    const nodeCount = 20_000;
    const nodes = Array.from({ length: nodeCount }, (_, index) =>
      stepNode(`step:deep:s1:p${index}`, "codex:deep", 1, `p${index}`)
    );
    const edges = Array.from({ length: nodeCount - 1 }, (_, index) =>
      transition(`deep-${index}`, nodes[index].id, nodes[index + 1].id)
    );

    const graph = analyzeAgentGraph({
      source: "observed-events",
      ts: 1,
      window: { retainedEvents: nodeCount, graphEvents: nodeCount },
      nodes,
      edges,
    });

    assert.equal(graph.stats.loops, 0);
    assert.equal(graph.stats.transitionEdges, nodeCount - 1);
  });
});
