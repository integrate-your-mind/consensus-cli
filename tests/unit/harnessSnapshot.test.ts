import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgentGraph } from "../../src/graph.js";
import { attachHarnessEvents } from "../../src/harnessSnapshot.js";
import type { NormalizedHarnessHookEvent } from "../../src/harnessHookModel.js";
import {
  handleNormalizedHarnessEvent,
  resetHarnessActivityForTests,
} from "../../src/services/harnessEvents.js";
import type { AgentSnapshot, SnapshotPayload } from "../../src/types.js";

function event(
  type: NormalizedHarnessHookEvent["type"],
  timestamp: number,
  extra: Partial<NormalizedHarnessHookEvent> = {}
): NormalizedHarnessHookEvent {
  return {
    version: 1,
    harnessId: "factory",
    type,
    sessionKey: "a".repeat(24),
    cwdKey: "b".repeat(24),
    timestamp,
    ...extra,
  };
}

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    identity: "factory:pid:10:start:1",
    id: "10",
    pid: 10,
    cmd: "factory agent",
    cmdShort: "factory agent",
    kind: "factory-cli",
    cpu: 0,
    mem: 0,
    state: "idle",
    harnessSessionKey: "a".repeat(24),
    harnessCwdKey: "b".repeat(24),
    ...overrides,
  };
}

function snapshot(agents: AgentSnapshot[], ts = 100): SnapshotPayload {
  return { ts, agents };
}

beforeEach(() => {
  resetHarnessActivityForTests();
});

describe("harness snapshot attachment", () => {
  it("attaches exact session history and active state", () => {
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, { turnKey: "c".repeat(24) }),
      false
    );
    handleNormalizedHarnessEvent(
      event("PreToolUse", 91, {
        turnKey: "c".repeat(24),
        toolName: "Execute",
      }),
      false
    );

    const attached = attachHarnessEvents(snapshot([agent()]));
    const current = attached.agents[0];
    assert.equal(current.state, "active");
    assert.equal(current.activityReason, "harness_hook_in_flight");
    assert.deepEqual(
      current.events?.map((entry) => entry.summary),
      ["prompt", "tool: Execute"]
    );
    assert.equal(current.summary?.lastPrompt, "prompt");
    assert.equal(current.summary?.lastTool, "tool: Execute");
    assert.equal(current.harnessSessionKey, "a".repeat(24));
  });

  it("uses cwd matching when the process command has no session id", () => {
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, { sessionKey: "d".repeat(24) }),
      false
    );
    const attached = attachHarnessEvents(
      snapshot([
        agent({ harnessSessionKey: undefined, harnessCwdKey: "b".repeat(24) }),
      ])
    );

    assert.equal(attached.agents[0].harnessSessionKey, "d".repeat(24));
    assert.equal(attached.agents[0].state, "active");
  });

  it("rejects cwd matching when several hook sessions share the directory", () => {
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, {
        sessionKey: "d".repeat(24),
        cwdKey: "b".repeat(24),
      }),
      false
    );
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 91, {
        sessionKey: "e".repeat(24),
        cwdKey: "b".repeat(24),
      }),
      false
    );

    const attached = attachHarnessEvents(
      snapshot([
        agent({ harnessSessionKey: undefined, harnessCwdKey: "b".repeat(24) }),
      ])
    );

    assert.equal(attached.agents[0].events, undefined);
    assert.equal(attached.agents[0].harnessSessionKey, undefined);
    assert.equal(attached.agents[0].state, "idle");
  });

  it("uses an exact session key even when cwd matching is ambiguous", () => {
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, {
        sessionKey: "d".repeat(24),
        cwdKey: "b".repeat(24),
      }),
      false
    );
    handleNormalizedHarnessEvent(
      event("Stop", 91, {
        sessionKey: "e".repeat(24),
        cwdKey: "b".repeat(24),
      }),
      false
    );

    const attached = attachHarnessEvents(
      snapshot([
        agent({
          harnessSessionKey: "d".repeat(24),
          harnessCwdKey: "b".repeat(24),
        }),
      ])
    );

    assert.equal(attached.agents[0].harnessSessionKey, "d".repeat(24));
    assert.equal(attached.agents[0].state, "active");
    assert.deepEqual(
      attached.agents[0].events?.map((entry) => entry.summary),
      ["prompt"]
    );
  });

  it("uses one-to-one fallback only when assignment is unambiguous", () => {
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, {
        sessionKey: "e".repeat(24),
        cwdKey: undefined,
      }),
      false
    );
    const single = attachHarnessEvents(
      snapshot([agent({ harnessSessionKey: undefined, harnessCwdKey: undefined })])
    );
    assert.equal(single.agents[0].harnessSessionKey, "e".repeat(24));

    resetHarnessActivityForTests();
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, {
        sessionKey: "e".repeat(24),
        cwdKey: undefined,
      }),
      false
    );
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 91, {
        sessionKey: "f".repeat(24),
        cwdKey: undefined,
      }),
      false
    );
    const ambiguous = attachHarnessEvents(
      snapshot([agent({ harnessSessionKey: undefined, harnessCwdKey: undefined })])
    );
    assert.equal(ambiguous.agents[0].events, undefined);
  });

  it("does not overwrite newer specialized activity with stale hook state", () => {
    handleNormalizedHarnessEvent(event("Stop", 80), false);
    const attached = attachHarnessEvents(
      snapshot([
        agent({
          state: "active",
          lastEventAt: 95,
          lastActivityAt: 95,
          activityReason: "native_event",
        }),
      ])
    );

    assert.equal(attached.agents[0].state, "active");
    assert.equal(attached.agents[0].activityReason, "native_event");
    assert.equal(attached.agents[0].lastEventAt, 95);
    assert.deepEqual(
      attached.agents[0].events?.map((entry) => entry.type),
      ["turn.completed"]
    );
  });

  it("keeps sessions isolated when several agents share a harness", () => {
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, {
        sessionKey: "1".repeat(24),
        cwdKey: "3".repeat(24),
      }),
      false
    );
    handleNormalizedHarnessEvent(
      event("Stop", 91, {
        sessionKey: "2".repeat(24),
        cwdKey: "4".repeat(24),
      }),
      false
    );
    const attached = attachHarnessEvents(
      snapshot([
        agent({
          identity: "factory:1",
          id: "1",
          pid: 1,
          harnessSessionKey: "1".repeat(24),
          harnessCwdKey: "3".repeat(24),
        }),
        agent({
          identity: "factory:2",
          id: "2",
          pid: 2,
          harnessSessionKey: "2".repeat(24),
          harnessCwdKey: "4".repeat(24),
        }),
      ])
    );

    assert.equal(attached.agents[0].state, "active");
    assert.equal(attached.agents[1].state, "idle");
  });

  it("turns attached hook metadata into provider-scoped graph phases", () => {
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 90, { turnKey: "c".repeat(24) }),
      false
    );
    handleNormalizedHarnessEvent(
      event("PreToolUse", 91, {
        turnKey: "c".repeat(24),
        toolName: "Execute",
      }),
      false
    );
    handleNormalizedHarnessEvent(
      event("Stop", 92, { turnKey: "c".repeat(24) }),
      false
    );

    const graph = buildAgentGraph(attachHarnessEvents(snapshot([agent()], 100)));
    assert.equal(graph.coverage.providers.factory.history, "available");
    assert.deepEqual(
      graph.nodes
        .filter((node) => node.kind === "step")
        .map((node) => node.phase)
        .sort(),
      ["prompt", "tool"]
    );
    assert.equal(graph.stats.loops, 0);
  });
});
