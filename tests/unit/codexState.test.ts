import test from "node:test";
import assert from "node:assert/strict";
import { deriveCodexState } from "../../src/codexState.ts";

test("codex ignores cpu spikes without activity", () => {
  const result = deriveCodexState({
    cpu: 12,
    hasError: false,
    lastActivityAt: undefined,
    inFlight: false,
    now: 1_000,
  });
  assert.equal(result.state, "idle");
});

test("codex activates after sustained cpu without activity timestamps", () => {
  const result = deriveCodexState({
    cpu: 12,
    hasError: false,
    lastActivityAt: undefined,
    inFlight: false,
    now: 2_000,
    cpuThreshold: 1,
    cpuActiveMs: 1_200,
    cpuSustainMs: 1_000,
  });
  assert.equal(result.state, "active");
});

test("codex activates with in-flight work when activity timestamp is recent", () => {
  const result = deriveCodexState({
    cpu: 0,
    hasError: false,
    lastActivityAt: 900,
    inFlight: true,
    now: 1_000,
    eventWindowMs: 1_000,
  });
  assert.equal(result.state, "active");
});

test("codex strict in-flight ignores recent activity when not in-flight", () => {
  const result = deriveCodexState({
    cpu: 0,
    hasError: false,
    lastActivityAt: 900,
    inFlight: false,
    now: 1_000,
    strictInFlight: true,
  });
  assert.equal(result.state, "idle");
});

test("codex clears in-flight when activity is stale and cpu is low", () => {
  const result = deriveCodexState({
    cpu: 0.5,
    hasError: false,
    lastActivityAt: 0,
    inFlight: true,
    now: 20_000,
    cpuThreshold: 1,
    inFlightIdleMs: 5_000,
    eventWindowMs: 1_000,
  });
  assert.equal(result.state, "idle");
});

test("codex drops to idle when activity is stale even if cpu is high", () => {
  const result = deriveCodexState({
    cpu: 5,
    hasError: false,
    lastActivityAt: 0,
    inFlight: true,
    now: 20_000,
    cpuThreshold: 1,
    inFlightIdleMs: 5_000,
    eventWindowMs: 1_000,
  });
  assert.equal(result.state, "idle");
});

test("codex activates when activity timestamp is recent", () => {
  const result = deriveCodexState({
    cpu: 0,
    hasError: false,
    lastActivityAt: 900,
    inFlight: false,
    now: 1_000,
    eventWindowMs: 5_000,
  });
  assert.equal(result.state, "active");
});

test("codex stays active when in-flight without recent activity", () => {
  const result = deriveCodexState({
    cpu: 0,
    hasError: false,
    lastActivityAt: undefined,
    inFlight: true,
    now: 1_000,
    eventWindowMs: 100,
  });
  assert.equal(result.state, "active");
});

test("codex stays idle on prompt-only timestamps", () => {
  const result = deriveCodexState({
    cpu: 0,
    hasError: false,
    inFlight: false,
    now: 1_000,
    eventWindowMs: 500,
  });
  assert.equal(result.state, "idle");
});

test("codex holds active briefly after activity stops", () => {
  const now = 10_000;
  const first = deriveCodexState({
    cpu: 2,
    hasError: false,
    lastActivityAt: now - 200,
    inFlight: false,
    now,
    eventWindowMs: 1000,
  });
  assert.equal(first.state, "active");

  const second = deriveCodexState({
    cpu: 0,
    hasError: false,
    lastActivityAt: now - 5000,
    inFlight: false,
    previousActiveAt: first.lastActiveAt,
    now: now + 500,
    holdMs: 2000,
    eventWindowMs: 1000,
  });
  assert.equal(second.state, "active");

  const third = deriveCodexState({
    cpu: 0,
    hasError: false,
    lastActivityAt: now - 5000,
    inFlight: false,
    previousActiveAt: first.lastActiveAt,
    now: now + 2500,
    holdMs: 2000,
    eventWindowMs: 1000,
  });
  assert.equal(third.state, "idle");
});
