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

test("codex activates with in-flight work even without activity timestamp", () => {
  const result = deriveCodexState({
    cpu: 0,
    hasError: false,
    lastActivityAt: undefined,
    inFlight: true,
    now: 1_000,
  });
  assert.equal(result.state, "active");
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
