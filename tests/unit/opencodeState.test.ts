import test from "node:test";
import assert from "node:assert/strict";
import { deriveOpenCodeState } from "../../src/opencodeState.ts";


test("opencode running status without evidence is idle", () => {
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    now: Date.now(),
  });
  assert.equal(result.state, "idle");
});

test("opencode active when inFlight true", () => {
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    inFlight: true,
    now: Date.now(),
  });
  assert.equal(result.state, "active");
});

test("opencode ignores lastEventAt without activity", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    lastEventAt: now - 200,
    eventWindowMs: 1000,
    now,
  });
  assert.equal(result.state, "idle");
});

test("opencode inFlight decays after idle window", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    inFlight: true,
    lastActivityAt: now - 2_000,
    inFlightIdleMs: 1_000,
    now,
  });
  assert.equal(result.state, "idle");
});

test("opencode holds active during brief idle gap while running", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    previousActiveAt: now - 500,
    holdMs: 1000,
    now,
  });
  assert.equal(result.state, "active");
});

test("opencode drops to idle after hold window while running", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    previousActiveAt: now - 2000,
    holdMs: 1000,
    now,
  });
  assert.equal(result.state, "idle");
});

test("opencode preserves lastActiveAt when idle to enable hold mechanism", () => {
  const now = 1_000;
  const holdMs = 500;

  const active = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    lastActivityAt: now,
    inFlight: true,
    now,
    holdMs,
  });

  assert.equal(active.state, "active");
  assert.equal(active.lastActiveAt, now);

  const holding = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    lastActivityAt: now,
    inFlight: false,
    now: now + 200,
    previousActiveAt: active.lastActiveAt,
    holdMs,
  });

  assert.equal(holding.state, "active");
  assert.equal(holding.reason, "hold");
  assert.equal(holding.lastActiveAt, now);

  const idle = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    lastActivityAt: now,
    inFlight: false,
    now: now + 600,
    previousActiveAt: active.lastActiveAt,
    holdMs,
  });

  assert.equal(idle.state, "idle");
  assert.equal(idle.lastActiveAt, now);
});

test("opencode server mode preserves lastActiveAt", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    cpu: 10,
    hasError: false,
    status: "running",
    isServer: true,
    previousActiveAt: now - 5_000,
    holdMs: 10_000,
    now,
  });
  assert.equal(result.state, "idle");
  assert.equal(result.lastActiveAt, now - 5_000);
});

test("opencode idle status preserves lastActiveAt for non-server agents", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "idle",
    previousActiveAt: now - 2_000,
    holdMs: 10_000,
    now,
  });
  assert.equal(result.state, "idle");
  assert.equal(result.lastActiveAt, now - 2_000);
});
