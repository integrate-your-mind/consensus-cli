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

test("codex event state: hold expires after in-flight ends", () => {
  const now = Date.now();
  const holdMs = 2000;
  const lastActivityAt = now;
  const active = deriveCodexEventState({
    inFlight: false,
    lastActivityAt,
    hasError: false,
    now: now + holdMs - 1,
    holdMs,
    idleMs: 20000,
  });
  const idle = deriveCodexEventState({
    inFlight: false,
    lastActivityAt,
    hasError: false,
    now: now + holdMs + 1,
    holdMs,
    idleMs: 20000,
  });
  assert.equal(active.state, "active");
  assert.equal(active.reason, "event_hold");
  assert.equal(idle.state, "idle");
  assert.equal(idle.reason, "event_idle");
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

test("codex event state: holdMs=0 yields immediate idle when not inFlight", () => {
  const now = 10_000;
  const result = deriveCodexEventState({
    inFlight: false,
    lastActivityAt: now - 1,
    hasError: false,
    now,
    holdMs: 0,
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
