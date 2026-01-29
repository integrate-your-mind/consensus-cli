import test from "node:test";
import assert from "node:assert/strict";
import { deriveClaudeState } from "../../src/claudeCli.ts";

test("claude tui with low cpu stays idle", () => {
  const result = deriveClaudeState({ cpu: 0.2, info: { kind: "claude-tui" } });
  assert.equal(result.state, "idle");
});

test("claude print with prompt marks active", () => {
  const result = deriveClaudeState({
    cpu: 0.2,
    info: { kind: "claude-cli", prompt: "ping" },
  });
  assert.equal(result.state, "idle");
});

test("claude tui ignores short cpu spikes without work", () => {
  const result = deriveClaudeState({
    cpu: 4,
    info: { kind: "claude-tui" },
    cpuActiveMs: 500,
    cpuThreshold: 1,
  });
  assert.equal(result.state, "idle");
});

test("claude tui activates after sustained cpu", () => {
  const result = deriveClaudeState({
    cpu: 6,
    info: { kind: "claude-tui" },
    cpuActiveMs: 2500,
    cpuThreshold: 1,
  });
  assert.equal(result.state, "active");
});

test("claude tui ignores single cpu spike without sustained work", () => {
  const result = deriveClaudeState({
    cpu: 9,
    info: { kind: "claude-tui" },
    cpuActiveMs: 0,
    cpuThreshold: 1,
  });
  assert.equal(result.state, "idle");
});

test("claude prompt transitions back to idle without work", () => {
  const now = 1_000;
  const first = deriveClaudeState({
    cpu: 0.5,
    info: { kind: "claude-cli", prompt: "ping" },
    now,
  });
  assert.equal(first.state, "idle");

  const second = deriveClaudeState({
    cpu: 0,
    info: { kind: "claude-cli" },
    previousActiveAt: first.lastActiveAt,
    now: now + 1500,
  });
  assert.equal(second.state, "idle");
  assert.equal(second.lastActiveAt, undefined);
});
