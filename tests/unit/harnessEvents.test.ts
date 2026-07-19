import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyHarnessEvent,
  getHarnessActivityBySession,
  handleNormalizedHarnessEvent,
  listHarnessActivity,
  resetHarnessActivityForTests,
  type HarnessSessionState,
} from "../../src/services/harnessEvents.js";
import type { NormalizedHarnessHookEvent } from "../../src/harnessHookModel.js";

function event(
  type: NormalizedHarnessHookEvent["type"],
  timestamp: number,
  extra: Partial<NormalizedHarnessHookEvent> = {}
): NormalizedHarnessHookEvent {
  return {
    version: 1,
    harnessId: "kimi",
    type,
    sessionKey: "a".repeat(24),
    timestamp,
    ...extra,
  };
}

beforeEach(() => {
  resetHarnessActivityForTests();
});

describe("harness event state", () => {
  it("builds bounded turn history and clears in-flight state on stop", () => {
    let map = new Map<string, HarnessSessionState>();
    map = applyHarnessEvent(map, event("UserPromptSubmit", 1, { turnKey: "b".repeat(24) }));
    map = applyHarnessEvent(
      map,
      event("PreToolUse", 2, {
        turnKey: "b".repeat(24),
        toolName: "Bash",
      })
    );
    map = applyHarnessEvent(map, event("Stop", 3, { turnKey: "b".repeat(24) }));
    const state = [...map.values()][0];

    assert.equal(state.inFlight, false);
    assert.equal(state.hasError, false);
    assert.equal(state.lastActivityAt, undefined);
    assert.deepEqual(
      state.events.map((entry) => [entry.type, entry.summary]),
      [
        ["UserPromptSubmit", "prompt"],
        ["PreToolUse", "tool: Bash"],
        ["turn.completed", "event: Stop"],
      ]
    );
  });

  it("deduplicates repeated hook deliveries", () => {
    const duplicate = event("PreToolUse", 1, { toolName: "Bash" });
    let map = applyHarnessEvent(new Map(), duplicate);
    map = applyHarnessEvent(map, duplicate);
    const state = [...map.values()][0];

    assert.equal(state.events.length, 1);
    assert.equal(state.inFlight, true);
  });

  it("merges older history without overwriting newer live state", () => {
    let map = applyHarnessEvent(new Map(), event("UserPromptSubmit", 200));
    map = applyHarnessEvent(map, event("StopFailure", 100));
    const state = [...map.values()][0];

    assert.equal(state.inFlight, true);
    assert.equal(state.hasError, false);
    assert.equal(state.lastSeenAt, 200);
    assert.equal(state.lastEventType, "UserPromptSubmit");
    assert.deepEqual(
      state.events.map((entry) => entry.type),
      ["turn.failed", "UserPromptSubmit"]
    );
  });

  it("marks current failures and clears them on later successful activity", () => {
    let map = applyHarnessEvent(new Map(), event("PostToolUseFailure", 1));
    let state = [...map.values()][0];
    assert.equal(state.hasError, true);
    assert.equal(state.inFlight, true);

    map = applyHarnessEvent(map, event("PostToolUse", 2));
    state = [...map.values()][0];
    assert.equal(state.hasError, false);
    assert.equal(state.inFlight, true);
  });

  it("expires an in-flight session after the configured timeout", () => {
    const previous = process.env.CONSENSUS_HARNESS_INFLIGHT_TIMEOUT_MS;
    process.env.CONSENSUS_HARNESS_INFLIGHT_TIMEOUT_MS = "10";
    try {
      handleNormalizedHarnessEvent(event("UserPromptSubmit", 100), false);
      assert.equal(
        getHarnessActivityBySession("kimi", "a".repeat(24), 105)?.inFlight,
        true
      );
      assert.equal(
        getHarnessActivityBySession("kimi", "a".repeat(24), 111)?.inFlight,
        false
      );
    } finally {
      if (previous === undefined) {
        delete process.env.CONSENSUS_HARNESS_INFLIGHT_TIMEOUT_MS;
      } else {
        process.env.CONSENSUS_HARNESS_INFLIGHT_TIMEOUT_MS = previous;
      }
    }
  });

  it("keeps sessions isolated by harness and opaque session key", () => {
    handleNormalizedHarnessEvent(event("UserPromptSubmit", 1), false);
    handleNormalizedHarnessEvent(
      event("UserPromptSubmit", 2, {
        harnessId: "factory",
        sessionKey: "c".repeat(24),
      }),
      false
    );

    assert.equal(listHarnessActivity("kimi", 2).length, 1);
    assert.equal(listHarnessActivity("factory", 2).length, 1);
    assert.equal(listHarnessActivity("qwen", 2).length, 0);
  });
});
