import test from "node:test";
import assert from "node:assert/strict";
import { deriveOpenCodeState } from "../../src/opencodeState.ts";


test("opencode running status without evidence is idle", () => {
  const result = deriveOpenCodeState({
    hasError: false,
    status: "running",
    now: Date.now(),
  });
  assert.equal(result.state, "idle");
});

test("opencode active when inFlight true", () => {
  const result = deriveOpenCodeState({
    hasError: false,
    status: "running",
    inFlight: true,
    now: Date.now(),
  });
  assert.equal(result.state, "active");
});

test("opencode idle status does not override inFlight true", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    hasError: false,
    status: "idle",
    inFlight: true,
    lastActivityAt: now,
    now,
  });
  assert.equal(result.state, "active");
  assert.equal(result.reason, "in_flight");
});

test("opencode ignores lastEventAt without activity", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
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
    hasError: false,
    status: "running",
    inFlight: true,
    lastActivityAt: now - 2_000,
    inFlightIdleMs: 1_000,
    now,
  });
  assert.equal(result.state, "idle");
});

test("opencode inFlight does not decay when idle decay is disabled", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    hasError: false,
    status: "running",
    inFlight: true,
    lastActivityAt: now - 10_000,
    inFlightIdleMs: -1,
    now,
  });
  assert.equal(result.state, "active");
  assert.equal(result.reason, "in_flight");
});

test("opencode inFlight decay uses most recent event timestamp", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    hasError: false,
    status: "running",
    inFlight: true,
    lastActivityAt: now - 10_000,
    lastEventAt: now - 500,
    inFlightIdleMs: 1_000,
    now,
  });
  assert.equal(result.state, "active");
  assert.equal(result.reason, "in_flight");
});

test("opencode holds active during brief idle gap while running", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
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

test("opencode server animates when inFlight true", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    hasError: false,
    status: "running",
    inFlight: true,
    isServer: true,
    now,
  });
  assert.equal(result.state, "active");
  assert.equal(result.reason, "in_flight");
  assert.equal(result.lastActiveAt, now);
});

test("opencode idle status preserves lastActiveAt for non-server agents", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    hasError: false,
    status: "idle",
    previousActiveAt: now - 2_000,
    holdMs: 10_000,
    now,
  });
  assert.equal(result.state, "idle");
  assert.equal(result.lastActiveAt, now - 2_000);
});

// =============================================================================
// Flicker Prevention Tests - Simulating Real Usage Scenarios
// =============================================================================

test("opencode maintains active during inFlight=true -> inFlight=false -> inFlight=true cycle", () => {
  const now = 1_000_000;
  const holdMs = 3000;

  // Step 1: inFlight=true (agent generating)
  const step1 = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now,
    now,
    holdMs,
  });
  assert.equal(step1.state, "active", "Step 1: Should be active when inFlight=true");
  assert.equal(step1.reason, "in_flight");

  // Step 2: inFlight=false (brief gap between turns)
  const step2 = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now,
    previousActiveAt: step1.lastActiveAt,
    now: now + 500, // 500ms later
    holdMs,
  });
  assert.equal(step2.state, "active", "Step 2: Should stay active due to hold mechanism");
  assert.equal(step2.reason, "hold");

  // Step 3: inFlight=true again (next turn)
  const step3 = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now + 1000,
    previousActiveAt: step2.lastActiveAt,
    now: now + 1000,
    holdMs,
  });
  assert.equal(step3.state, "active", "Step 3: Should be active when inFlight=true again");
  assert.equal(step3.reason, "in_flight");
});

test("opencode transitions to idle only after hold period expires", () => {
  const now = 1_000_000;
  const holdMs = 3000;

  // Active generation
  const active = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now,
    now,
    holdMs,
  });
  assert.equal(active.state, "active");

  // Just finished - within hold period
  const holding1 = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now,
    previousActiveAt: active.lastActiveAt,
    now: now + 1000, // 1 second later
    holdMs,
  });
  assert.equal(holding1.state, "active", "Should be holding at 1 second");

  // Still within hold period
  const holding2 = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now,
    previousActiveAt: active.lastActiveAt,
    now: now + 2500, // 2.5 seconds later
    holdMs,
  });
  assert.equal(holding2.state, "active", "Should be holding at 2.5 seconds");

  // Hold period expired
  const idle = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now,
    previousActiveAt: active.lastActiveAt,
    now: now + 4000, // 4 seconds later (past 3s hold)
    holdMs,
  });
  assert.equal(idle.state, "idle", "Should be idle after hold period expires");
});

test("opencode strict inFlight mode ignores hold mechanism", () => {
  const now = 1_000_000;

  // With strict mode, should immediately go idle when inFlight=false
  const result = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now,
    previousActiveAt: now,
    now: now + 100, // Just 100ms later
    holdMs: 3000,
    strictInFlight: true,
  });
  assert.equal(result.state, "idle", "Strict mode should ignore hold mechanism");
  assert.equal(result.reason, "idle");
});

test("opencode strict inFlight mode shows active when inFlight=true", () => {
  const result = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    now: Date.now(),
    strictInFlight: true,
  });
  assert.equal(result.state, "active");
  assert.equal(result.reason, "in_flight");
});

test("opencode strict inFlight uses lastActivityAt for lastActiveAt", () => {
  const now = 1_000_000;
  const result = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now - 2_000,
    now,
    strictInFlight: true,
  });
  assert.equal(result.state, "active");
  assert.equal(result.lastActiveAt, now - 2_000);
});

test("opencode error state takes precedence over inFlight", () => {
  const result = deriveOpenCodeState({
    hasError: true,
    inFlight: true,
    now: Date.now(),
  });
  assert.equal(result.state, "error");
});

test("opencode status error takes precedence over inFlight", () => {
  const result = deriveOpenCodeState({
    hasError: false,
    status: "error",
    inFlight: true,
    now: Date.now(),
  });
  assert.equal(result.state, "error");
  assert.equal(result.reason, "status_error");
});

test("opencode status idle overrides inFlight when no event activity inFlight", () => {
  const result = deriveOpenCodeState({
    hasError: false,
    status: "idle",
    inFlight: false,
    now: Date.now(),
  });
  assert.equal(result.state, "idle");
  assert.equal(result.reason, "status_idle");
});

test("opencode new activity resets hold timer", () => {
  const now = 1_000_000;
  const holdMs = 3000;

  // Initial active state
  const active1 = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now,
    now,
    holdMs,
  });

  // Brief idle
  const holding = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now,
    previousActiveAt: active1.lastActiveAt,
    now: now + 2000,
    holdMs,
  });
  assert.equal(holding.state, "active", "Should be holding");

  // New activity at a later time - this resets the timer
  const active2 = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now + 2500,
    previousActiveAt: holding.lastActiveAt,
    now: now + 2500,
    holdMs,
  });
  assert.equal(active2.state, "active");
  assert.equal(active2.lastActiveAt, now + 2500, "lastActiveAt should be updated to new activity time");

  // Now if we go idle, hold should be relative to new lastActiveAt
  const holdingNew = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now + 2500,
    previousActiveAt: active2.lastActiveAt,
    now: now + 4000, // 1.5s after new activity (within hold)
    holdMs,
  });
  assert.equal(holdingNew.state, "active", "Should still be holding based on new activity time");
});

test("opencode inFlightIdleMs causes inFlight to decay when no activity", () => {
  const now = 1_000_000;
  const inFlightIdleMs = 5000;

  // inFlight=true but lastActivityAt is old
  const result = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now - 10000, // 10 seconds ago
    now,
    inFlightIdleMs,
  });
  assert.equal(result.state, "idle", "inFlight should decay after inFlightIdleMs");
});

test("opencode inFlightIdleMs does not decay when activity is recent", () => {
  const now = 1_000_000;
  const inFlightIdleMs = 5000;

  const result = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now - 2000, // 2 seconds ago (within 5s window)
    now,
    inFlightIdleMs,
  });
  assert.equal(result.state, "active", "inFlight should not decay when activity is recent");
});

// =============================================================================
// Multiple TUI Session Scenario Tests
// =============================================================================

test("opencode derives correct state for multiple sessions independently", () => {
  const now = 1_000_000;
  const holdMs = 3000;

  // Session 1: actively generating
  const session1 = deriveOpenCodeState({
    hasError: false,
    inFlight: true,
    lastActivityAt: now,
    now,
    holdMs,
  });

  // Session 2: just finished, in hold period
  const session2 = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now - 1000,
    previousActiveAt: now - 1000,
    now,
    holdMs,
  });

  // Session 3: idle for a while
  const session3 = deriveOpenCodeState({
    hasError: false,
    inFlight: false,
    lastActivityAt: now - 10000,
    previousActiveAt: now - 10000,
    now,
    holdMs,
  });

  assert.equal(session1.state, "active", "Session 1 should be active (generating)");
  assert.equal(session2.state, "active", "Session 2 should be active (holding)");
  assert.equal(session3.state, "idle", "Session 3 should be idle (past hold)");
});
