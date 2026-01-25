import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateTail, summarizeTail } from "../../src/codexLogs.ts";

test("summarizes codex exec session logs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "thread.started",
      ts: 1,
      item: { type: "prompt", input: "Run /Users/alice/app" },
    },
    {
      type: "item.completed",
      ts: 2,
      item: { type: "command_execution", command: "npm test" },
    },
    {
      type: "item.completed",
      ts: 3,
      item: { type: "file_change", path: "/Users/alice/app/src/index.ts" },
    },
    {
      type: "item.completed",
      ts: 4,
      item: { type: "mcp_tool_call", tool_name: "functions.exec_command" },
    },
    {
      type: "item.completed",
      ts: 5,
      item: { type: "assistant_message", content: "All done" },
    },
    {
      type: "turn.completed",
      ts: 6,
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.doing, "cmd: npm test");
  assert.equal(summary.summary.current, "cmd: npm test");
  assert.equal(summary.summary.lastCommand, "cmd: npm test");
  assert.equal(summary.summary.lastEdit, "edit: ~/app/src/index.ts");
  assert.equal(summary.summary.lastTool, "tool: functions.exec_command");
  assert.equal(summary.summary.lastPrompt, "prompt: Run ~/app");
  assert.equal(summary.summary.lastMessage, "All done");
  assert.equal(summary.events.length, 6);
  assert.ok(summary.events.some((event) => event.summary === "event: turn.completed"));

  await fs.rm(dir, { recursive: true, force: true });
});

test("parses trailing codex event without newline", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "item.completed",
      ts: 10,
      item: { type: "command_execution", command: "npm run build" },
    },
    {
      type: "item.completed",
      ts: 11,
      item: { type: "assistant_message", content: "done" },
    },
  ];

  await fs.writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n"));

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastCommand, "cmd: npm run build");
  assert.equal(summary.summary.lastMessage, "done");

  await fs.rm(dir, { recursive: true, force: true });
});

test("expires in-flight codex state after timeout", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "1000";

  const lines = [
    {
      type: "item.started",
      ts: 1,
      item: { type: "command_execution", command: "npm run build" },
    },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 1_500;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 12_500;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, false);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  await fs.rm(dir, { recursive: true, force: true });
});
