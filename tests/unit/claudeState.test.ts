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
  assert.equal(result.state, "active");
});
