import test from "node:test";
import assert from "node:assert/strict";
import { deriveState, deriveStateWithHold } from "../../src/activity.ts";

test("marks active when recent event exists", () => {
  const now = Date.now();
  const state = deriveState({
    cpu: 0.1,
    hasError: false,
    lastEventAt: now - 1000,
    now,
    eventWindowMs: 5000,
  });
  assert.equal(state, "active");
});

test("marks idle when no recent activity", () => {
  const now = Date.now();
  const state = deriveState({
    cpu: 0.1,
    hasError: false,
    lastEventAt: now - 20000,
    now,
    eventWindowMs: 5000,
  });
  assert.equal(state, "idle");
});

test("keeps active at the event window boundary", () => {
  const now = Date.now();
  const state = deriveState({
    cpu: 0,
    hasError: false,
    lastEventAt: now - 5000,
    now,
    eventWindowMs: 5000,
  });
  assert.equal(state, "active");
});

test("drops to idle just past the event window", () => {
  const now = Date.now();
  const state = deriveState({
    cpu: 0,
    hasError: false,
    lastEventAt: now - 5001,
    now,
    eventWindowMs: 5000,
  });
  assert.equal(state, "idle");
});

test("marks error when hasError true", () => {
  const state = deriveState({ cpu: 20, hasError: true, lastEventAt: Date.now() });
  assert.equal(state, "error");
});

test("holds active state for a grace window", () => {
  const now = Date.now();
  const first = deriveStateWithHold({
    cpu: 12,
    hasError: false,
    lastEventAt: now - 1000,
    now,
    holdMs: 10000,
    eventWindowMs: 5000,
  });
  assert.equal(first.state, "active");
  const second = deriveStateWithHold({
    cpu: 0.1,
    hasError: false,
    lastEventAt: now - 20000,
    previousActiveAt: first.lastActiveAt,
    now: now + 5000,
    holdMs: 10000,
    eventWindowMs: 5000,
  });
  assert.equal(second.state, "active");
  const third = deriveStateWithHold({
    cpu: 0.1,
    hasError: false,
    lastEventAt: now - 20000,
    previousActiveAt: first.lastActiveAt,
    now: now + 15001,
    holdMs: 10000,
    eventWindowMs: 5000,
  });
  assert.equal(third.state, "idle");
});
