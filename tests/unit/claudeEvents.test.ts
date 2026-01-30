import test from "node:test";
import assert from "node:assert/strict";
import {
  handleClaudeEvent,
  getClaudeActivityBySession,
  getClaudeActivityByCwd,
} from "../../src/services/claudeEvents.ts";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test("marks inFlight and activity on prompt submit", () => {
  const sessionId = makeId("claude");
  const now = Date.now();
  handleClaudeEvent({
    type: "UserPromptSubmit",
    sessionId,
    cwd: "/tmp/claude",
    transcriptPath: "/tmp/claude.jsonl",
    timestamp: now,
  });

  const state = getClaudeActivityBySession(sessionId, now);
  assert.ok(state);
  assert.equal(state?.inFlight, true);
  assert.equal(state?.lastActivityAt, now);
  assert.equal(state?.cwd, "/tmp/claude");
});

test("clears inFlight on stop (case/format agnostic)", () => {
  const sessionId = makeId("claude-stop");
  const t0 = Date.now();
  handleClaudeEvent({
    type: "PreToolUse",
    sessionId,
    timestamp: t0,
  });
  const active = getClaudeActivityBySession(sessionId, t0);
  assert.ok(active);
  assert.equal(active?.lastInFlightSignalAt, t0);
  handleClaudeEvent({
    type: "stop",
    sessionId,
    timestamp: t0 + 50,
  });

  const state = getClaudeActivityBySession(sessionId, t0 + 50);
  assert.ok(state);
  assert.equal(state?.inFlight, false);
  assert.equal(state?.lastActivityAt, undefined);
  assert.equal(state?.lastInFlightSignalAt, undefined);
});

test("clears inFlight on session_end alias", () => {
  const sessionId = makeId("claude-session-end");
  const t0 = Date.now();
  handleClaudeEvent({
    type: "UserPromptSubmit",
    sessionId,
    timestamp: t0,
  });
  handleClaudeEvent({
    type: "session_end",
    sessionId,
    timestamp: t0 + 50,
  });

  const state = getClaudeActivityBySession(sessionId, t0 + 50);
  assert.ok(state);
  assert.equal(state?.inFlight, false);
  assert.equal(state?.lastActivityAt, undefined);
});

test("marks idle on Notification idle_prompt", () => {
  const sessionId = makeId("claude-idle-notify");
  const t0 = Date.now();
  handleClaudeEvent({
    type: "UserPromptSubmit",
    sessionId,
    timestamp: t0,
  });
  handleClaudeEvent({
    type: "Notification",
    sessionId,
    notificationType: "idle_prompt",
    timestamp: t0 + 100,
  });

  const state = getClaudeActivityBySession(sessionId, t0 + 100);
  assert.ok(state);
  assert.equal(state?.inFlight, false);
  assert.equal(state?.lastActivityAt, undefined);
});

test("selects most recent session by cwd", () => {
  const cwd = `/tmp/claude-${Date.now()}`;
  const sessionA = makeId("claude-cwd-a");
  const sessionB = makeId("claude-cwd-b");
  const t0 = Date.now();
  handleClaudeEvent({ type: "UserPromptSubmit", sessionId: sessionA, cwd, timestamp: t0 });
  handleClaudeEvent({
    type: "UserPromptSubmit",
    sessionId: sessionB,
    cwd,
    timestamp: t0 + 100,
  });

  const state = getClaudeActivityByCwd(cwd, t0 + 100);
  assert.ok(state);
  assert.equal(state?.sessionId, sessionB);
});

test("inFlight expires after timeout", () => {
  const sessionId = makeId("claude-timeout");
  const t0 = Date.now();
  handleClaudeEvent({ type: "PreToolUse", sessionId, timestamp: t0 });

  const state = getClaudeActivityBySession(sessionId, t0 + 20_000);
  assert.ok(state);
  assert.equal(state?.inFlight, false);
});

test("stale sessions are pruned", () => {
  const sessionId = makeId("claude-stale");
  const t0 = Date.now();
  handleClaudeEvent({ type: "UserPromptSubmit", sessionId, timestamp: t0 });

  const state = getClaudeActivityBySession(sessionId, t0 + 2_000_000);
  assert.equal(state, undefined);
});
