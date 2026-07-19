import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyClaudeEvent,
  boundedClaudeLabel,
  isStoredClaudeEvent,
  toStoredClaudeEvent,
  type ClaudeStateMap,
} from "../../src/services/claudeEventModel.js";
import type { ClaudeEvent } from "../../src/claude/types.js";

function event(
  type: string,
  timestamp: number,
  extra: Partial<ClaudeEvent> = {}
): ClaudeEvent {
  return {
    type,
    sessionId: "claude-model-session",
    timestamp,
    ...extra,
  } as ClaudeEvent;
}

function state(
  events: ClaudeEvent[]
): ReturnType<typeof applyClaudeEvent> {
  let map: ClaudeStateMap = new Map();
  for (const current of events) map = applyClaudeEvent(map, current);
  return map;
}

describe("Claude event model", () => {
  it("deduplicates repeated retained hook deliveries in memory", () => {
    const duplicate = event("PreToolUse", 100, { toolName: "Bash" });
    const map = state([duplicate, duplicate]);
    const current = map.get(duplicate.sessionId);

    assert.equal(current?.events.length, 1);
    assert.equal(current?.events[0].summary, "tool: Bash");
    assert.equal(current?.inFlight, true);
  });

  it("does not let an older stored stop event clear newer live activity", () => {
    const prompt = event("UserPromptSubmit", 200);
    let map = applyClaudeEvent(new Map(), prompt);
    map = applyClaudeEvent(map, event("Stop", 100));
    const current = map.get(prompt.sessionId);

    assert.equal(current?.inFlight, true);
    assert.equal(current?.lastSeenAt, 200);
    assert.equal(current?.lastEventAt, 200);
    assert.equal(current?.lastEvent, "UserPromptSubmit");
    assert.deepEqual(
      current?.events.map((entry) => [entry.ts, entry.type]),
      [
        [100, "Stop"],
        [200, "UserPromptSubmit"],
      ]
    );
  });

  it("does not let an older failure overwrite a newer successful state", () => {
    const message = event("MessageDisplay", 200, { final: true });
    let map = applyClaudeEvent(new Map(), message);
    map = applyClaudeEvent(map, event("StopFailure", 100));
    const current = map.get(message.sessionId);

    assert.notEqual(current?.hasError, true);
    assert.equal(current?.lastEvent, "MessageDisplay");
    assert.equal(current?.lastSeenAt, 200);
    assert.deepEqual(
      current?.events.map((entry) => entry.type),
      ["StopFailure", "MessageDisplay"]
    );
  });

  it("rejects invalid session ids and timestamps without mutating state", () => {
    const original: ClaudeStateMap = new Map();
    const controlSession = event("UserPromptSubmit", 100, {
      sessionId: "bad\nidentity",
    });
    const negativeTime = event("UserPromptSubmit", -1);

    assert.equal(applyClaudeEvent(original, controlSession), original);
    assert.equal(applyClaudeEvent(original, negativeTime), original);
    assert.equal(toStoredClaudeEvent(controlSession), undefined);
    assert.equal(toStoredClaudeEvent(negativeTime), undefined);
  });

  it("sanitizes and bounds metadata labels before persistence", () => {
    const label = `Bash\n\u001b[2J${"x".repeat(300)}`;
    const normalized = boundedClaudeLabel(label);
    const stored = toStoredClaudeEvent(
      event("PreToolUse", 100, { toolName: label })
    );

    assert.ok(normalized);
    assert.equal(normalized?.length, 160);
    assert.equal(/[\u0000-\u001f\u007f-\u009f]/.test(normalized ?? ""), false);
    assert.equal(stored?.toolName, normalized);
  });

  it("rejects malformed stored records at the disk boundary", () => {
    const base = {
      version: 1,
      type: "PreToolUse",
      sessionId: "stored-session",
      timestamp: 100,
      cwdKey: "a".repeat(24),
      toolName: "Bash",
    };

    assert.equal(isStoredClaudeEvent(base), true);
    assert.equal(
      isStoredClaudeEvent({ ...base, timestamp: -1 }),
      false
    );
    assert.equal(
      isStoredClaudeEvent({ ...base, cwdKey: "not-a-hash" }),
      false
    );
    assert.equal(
      isStoredClaudeEvent({ ...base, toolName: "Bash\nforged" }),
      false
    );
    assert.equal(
      isStoredClaudeEvent({ ...base, sessionId: "s".repeat(513) }),
      false
    );
  });
});
