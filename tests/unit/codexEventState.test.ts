import test from "node:test";
import assert from "node:assert/strict";
import { deriveCodexEventState } from "../../src/codexState.ts";

test("codex event state: inFlight stays active", () => {
  const now = Date.now();
  const result = deriveCodexEventState({
    inFlight: true,
    lastActivityAt: now - 1000,
    hasError: false,
    now,
    holdMs: 2000,
    idleMs: 20000,
  });
  assert.equal(result.state, "active");
  assert.equal(result.reason, "event_in_flight");
});

test("codex event state: hold after recent activity", () => {
  const now = Date.now();
  const result = deriveCodexEventState({
    inFlight: false,
    lastActivityAt: now - 500,
    hasError: false,
    now,
    holdMs: 2000,
    idleMs: 20000,
  });
  assert.equal(result.state, "active");
  assert.equal(result.reason, "event_hold");
});

test("codex event state: idle after hold window", () => {
  const now = Date.now();
  const result = deriveCodexEventState({
    inFlight: false,
    lastActivityAt: now - 5000,
    hasError: false,
    now,
    holdMs: 2000,
    idleMs: 20000,
  });
  assert.equal(result.state, "idle");
  assert.equal(result.reason, "event_idle");
});

test("codex event state: stale inFlight times out", () => {
  const now = Date.now();
  const result = deriveCodexEventState({
    inFlight: true,
    lastActivityAt: now - 30000,
    hasError: false,
    now,
    holdMs: 2000,
    idleMs: 20000,
  });
  assert.equal(result.state, "idle");
  assert.equal(result.reason, "event_timeout");
});

test("codex event state: error overrides activity", () => {
  const now = Date.now();
  const result = deriveCodexEventState({
    inFlight: true,
    lastActivityAt: now - 1000,
    hasError: true,
    now,
    holdMs: 2000,
    idleMs: 20000,
  });
  assert.equal(result.state, "error");
  assert.equal(result.reason, "error");
});
