import test from "node:test";
import assert from "node:assert/strict";
import { parseClaudeCommand, summarizeClaudeCommand } from "../../src/claudeCli.ts";

test("parses print mode prompt", () => {
  const info = parseClaudeCommand("claude -p --output-format json 'ping'");
  assert.ok(info);
  assert.equal(info?.kind, "claude-cli");
  assert.equal(info?.prompt, "ping");
  const summary = summarizeClaudeCommand("claude -p --output-format json 'ping'");
  assert.equal(summary?.doing, "prompt: ping");
});

test("parses resume and model", () => {
  const info = parseClaudeCommand("claude --resume abc123 --model sonnet");
  assert.ok(info);
  assert.equal(info?.resume, "abc123");
  assert.equal(info?.model, "sonnet");
});

test("parses continue mode", () => {
  const summary = summarizeClaudeCommand("/usr/local/bin/claude --continue");
  assert.equal(summary?.doing, "continue");
});
