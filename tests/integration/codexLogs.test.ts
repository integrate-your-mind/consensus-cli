import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateTail, summarizeTail, findSessionByCwd } from "../../src/codexLogs.ts";
import { getSessionStartMsFromPath, pickSessionForProcess } from "../../src/codexLogs.ts";

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
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= 5_000);

  await fs.rm(dir, { recursive: true, force: true });
});

test("matches session by cwd using session_meta", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const cwd = path.join(dir, "project");

  const lines = [
    {
      type: "session_meta",
      ts: 1,
      payload: { cwd, id: "session-test" },
    },
    {
      type: "response.completed",
      ts: 2,
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const stat = await fs.stat(file);

  const found = await findSessionByCwd([{ path: file, mtimeMs: stat.mtimeMs }], cwd);
  assert.equal(found?.path, file);

  await fs.rm(dir, { recursive: true, force: true });
});

test("matches session by cwd using session_meta timestamp", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const cwd = path.join(dir, "project");
  const fileA = path.join(dir, "a.jsonl");
  const fileB = path.join(dir, "b.jsonl");
  const now = Date.now();

  const linesA = [
    {
      type: "session_meta",
      ts: now - 60_000,
      payload: { cwd, id: "session-a", timestamp: new Date(now - 60_000).toISOString() },
    },
  ];
  const linesB = [
    {
      type: "session_meta",
      ts: now - 5_000,
      payload: { cwd, id: "session-b", timestamp: new Date(now - 5_000).toISOString() },
    },
  ];

  await fs.writeFile(fileA, `${linesA.map((line) => JSON.stringify(line)).join("\n")}\n`);
  await fs.writeFile(fileB, `${linesB.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const sessions = [
    { path: fileA, mtimeMs: now - 1_000 },
    { path: fileB, mtimeMs: now - 120_000 },
  ];

  const picked = await findSessionByCwd(sessions, cwd, now - 4_000);
  assert.ok(picked);
  assert.equal(picked?.path, fileB);

  await fs.rm(dir, { recursive: true, force: true });
});

test("parses session start from filename", () => {
  const path = "/tmp/rollout-2026-01-29T15-46-57-019c0b82-foo.jsonl";
  const start = getSessionStartMsFromPath(path);
  assert.ok(start);
  const expected = Date.parse("2026-01-29T15:46:57");
  assert.equal(start, expected);
});

test("pickSessionForProcess uses session start over mtime", () => {
  const sessions = [
    {
      path: "/tmp/rollout-2026-01-29T15-46-57-aaaa.jsonl",
      mtimeMs: Date.parse("2026-01-29T16:46:57Z"),
    },
    {
      path: "/tmp/rollout-2026-01-29T15-40-00-bbbb.jsonl",
      mtimeMs: Date.parse("2026-01-29T15:40:00Z"),
    },
  ];
  const startMs = getSessionStartMsFromPath(sessions[0].path) ?? 0;
  const picked = pickSessionForProcess(sessions, startMs);
  assert.ok(picked);
  assert.equal(picked?.path, sessions[0].path);
});

test("treats user_message as in-flight activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "event_msg",
      timestamp: "2026-01-29T20:00:00.000Z",
      payload: { type: "user_message", role: "user", content: "Run tests" },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, true);
  assert.ok(summary.lastActivityAt);

  await fs.rm(dir, { recursive: true, force: true });
});

test("marks prompts and assistant responses as activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "response_item",
      ts: 1,
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "ping" }],
      },
    },
    {
      type: "response_item",
      ts: 2,
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "pong" }],
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastPrompt, "prompt: ping");
  assert.equal(summary.summary.lastMessage, "pong");
  assert.equal(summary.lastActivityAt, 2_000);

  await fs.rm(dir, { recursive: true, force: true });
});

test("treats user-only prompts as in-flight activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "response_item",
      ts: now,
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "ping" }],
      },
    },
    {
      type: "response_item",
      ts: now + 1,
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "still waiting" }],
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastPrompt, "prompt: still waiting");
  assert.equal(summary.summary.lastMessage, undefined);
  assert.ok(summary.lastActivityAt);
  assert.equal(summary.inFlight, true);

  await fs.rm(dir, { recursive: true, force: true });
});

test("session metadata does not start in-flight work", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "session_meta",
      ts: now,
      payload: { cwd: "/tmp/project", id: "session-meta" },
    },
    {
      type: "thread.started",
      ts: now + 1,
      item: { type: "prompt", input: "hello" },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, undefined);

  await fs.rm(dir, { recursive: true, force: true });
});

test("summarizes response_item payloads for tools and commands", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "response_item",
      ts: 1,
      payload: {
        type: "tool_call",
        tool_name: "functions.exec_command",
      },
    },
    {
      type: "response_item",
      ts: 2,
      payload: {
        type: "command_execution",
        command: "npm test",
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastTool, "tool: functions.exec_command");
  assert.equal(summary.summary.lastCommand, "cmd: npm test");
  assert.equal(summary.summary.current, "cmd: npm test");
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= 2_000);

  await fs.rm(dir, { recursive: true, force: true });
});

test("marks response_item tool work as in-flight", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "response_item",
      ts: now,
      payload: {
        type: "function_call",
        name: "functions.exec_command",
        arguments: "{}",
      },
    },
    {
      type: "response_item",
      ts: now + 1,
      payload: {
        type: "function_call_output",
        call_id: "call_123",
        output: "ok",
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, true);
  assert.ok(summary.summary.lastTool?.startsWith("tool: "));

  await fs.rm(dir, { recursive: true, force: true });
});

test("assistant message does not end in-flight when no open calls", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "response_item",
      ts: now,
      payload: {
        type: "function_call",
        name: "functions.exec_command",
        call_id: "call_123",
        arguments: "{}",
      },
    },
    {
      type: "response_item",
      ts: now + 1,
      payload: {
        type: "function_call_output",
        call_id: "call_123",
        output: "ok",
      },
    },
    {
      type: "response_item",
      ts: now + 2,
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "done" }],
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, true);

  await fs.rm(dir, { recursive: true, force: true });
});

test("treats tool response items without names as activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "response_item",
      ts: 1,
      payload: {
        type: "function_call_output",
        call_id: "call_123",
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastTool, "tool: call_123");
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= 1_000);

  await fs.rm(dir, { recursive: true, force: true });
});

test("treats output response delta events as activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const now = Date.now();
  const lines = [
    {
      type: "response.output_text.delta",
      ts: now,
      delta: { text: "hi" },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= now);
  assert.equal(summary.inFlight, true);

  await fs.rm(dir, { recursive: true, force: true });
});

test("ignores input_text delta events for in-flight/activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const now = Date.now();
  const lines = [
    {
      type: "response.input_text.delta",
      ts: now,
      delta: { text: "hello" },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, undefined);
  assert.equal(summary.lastActivityAt, undefined);

  await fs.rm(dir, { recursive: true, force: true });
});

test("treats turn.started as in-flight activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "turn.started",
      ts: now,
      item: { type: "prompt", input: "hello" },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastPrompt, "prompt: hello");
  assert.equal(summary.inFlight, true);
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= now);

  await fs.rm(dir, { recursive: true, force: true });
});

test("treats item.started as in-flight activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "item.started",
      ts: now,
      item: { type: "command_execution", command: "npm run build" },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastCommand, "cmd: npm run build");
  assert.equal(summary.inFlight, true);
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= now);

  await fs.rm(dir, { recursive: true, force: true });
});

test("treats reasoning payloads as activity without exposing content", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "response_item",
      ts: 1,
      payload: {
        type: "reasoning",
        encrypted_content: "secret",
        summary: ["step"],
      },
    },
    {
      type: "event_msg",
      timestamp: 2,
      payload: {
        type: "agent_reasoning",
        encrypted_content: "secret",
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastMessage, "thinking");
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= 2_000);

  await fs.rm(dir, { recursive: true, force: true });
});

test("agent_message starts in-flight activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "event_msg",
      timestamp: 1,
      payload: {
        type: "agent_reasoning",
        text: "Working through the steps",
      },
    },
    {
      type: "event_msg",
      timestamp: 2,
      payload: {
        type: "agent_message",
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, true);

  await fs.rm(dir, { recursive: true, force: true });
});

test("treats event_msg text payloads as assistant messages", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "event_msg",
      timestamp: 1,
      payload: {
        type: "agent_reasoning",
        text: "Working through the steps",
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastMessage, "Working through the steps");
  assert.ok(summary.lastActivityAt && summary.lastActivityAt >= 1_000);

  await fs.rm(dir, { recursive: true, force: true });
});

test("stays active with periodic signals and turns idle after explicit end", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const pulseEveryMs = 300;
  const pollEveryMs = 50;
  const durationMs = 1500;

  const first = {
    type: "response.output_text.delta",
    ts: Date.now(),
    delta: { text: "hi" },
  };
  await fs.writeFile(file, `${JSON.stringify(first)}\n`);

  const start = Date.now();
  let nextPulse = start + pulseEveryMs;
  while (Date.now() - start < durationMs) {
    if (Date.now() >= nextPulse) {
      const line = {
        type: "response.output_text.delta",
        ts: Date.now(),
        delta: { text: "tick" },
      };
      await fs.appendFile(file, `${JSON.stringify(line)}\n`);
      nextPulse += pulseEveryMs;
    }
    const state = await updateTail(file);
    assert.ok(state);
    const summary = summarizeTail(state);
    assert.equal(summary.inFlight, true);
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }

  const endLine = {
    type: "response.completed",
    ts: Date.now(),
  };
  await fs.appendFile(file, `${JSON.stringify(endLine)}\n`);
  const endState = await updateTail(file);
  assert.ok(endState);
  const endSummary = summarizeTail(endState);
  assert.equal(endSummary.inFlight, undefined);

  await fs.rm(dir, { recursive: true, force: true });
});

test("does not expire in-flight without explicit end", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "response_item",
      ts: now,
      payload: {
        type: "function_call",
        name: "functions.exec_command",
        call_id: "call_123",
        arguments: "{}",
      },
    },
  ];

  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, true);
  assert.ok(typeof summary.lastInFlightSignalAt === "number");

  await new Promise((resolve) => setTimeout(resolve, 10));
  const summaryAfter = summarizeTail(state);
  assert.equal(summaryAfter.inFlight, true);

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

test("response.completed clears in-flight even without turn end", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  Date.now = () => 1_000;

  const started = {
    type: "response.started",
    ts: 1,
  };
  await fs.writeFile(file, `${JSON.stringify(started)}\n`);

  const first = await updateTail(file);
  assert.ok(first);
  const firstSummary = summarizeTail(first);
  assert.equal(firstSummary.inFlight, true);

  const completed = {
    type: "response.completed",
    ts: 2,
  };
  await fs.appendFile(file, `${JSON.stringify(completed)}\n`);

  Date.now = () => 5_000;
  const second = await updateTail(file);
  assert.ok(second);
  const secondSummary = summarizeTail(second);
  assert.equal(secondSummary.inFlight, undefined);

  const turnCompleted = {
    type: "turn.completed",
    ts: 3,
  };
  await fs.appendFile(file, `${JSON.stringify(turnCompleted)}\n`);
  Date.now = () => 3_000;
  const third = await updateTail(file);
  assert.ok(third);
  const thirdSummary = summarizeTail(third);
  assert.equal(thirdSummary.inFlight, undefined);

  Date.now = originalNow;
  await fs.rm(dir, { recursive: true, force: true });
});

test("does not expire in-flight codex state without explicit end when disabled", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "0";
  const lines = [
    {
      type: "response.started",
      ts: 1,
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
  assert.equal(summaryLater.inFlight, true);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("review mode keeps in-flight until exited", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS;
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";

  const entered = {
    type: "event_msg",
    ts: 1,
    payload: {
      type: "entered_review_mode",
      target: { type: "uncommittedChanges" },
    },
  };
  await fs.writeFile(file, `${JSON.stringify(entered)}\n`);

  Date.now = () => 1_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 10_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, true);

  const exited = {
    type: "event_msg",
    ts: 11,
    payload: {
      type: "exited_review_mode",
    },
  };
  await fs.appendFile(file, `${JSON.stringify(exited)}\n`);

  Date.now = () => 11_000;
  const stateExit = await updateTail(file);
  assert.ok(stateExit);
  const summaryExit = summarizeTail(stateExit);
  assert.equal(summaryExit.inFlight, undefined);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("forces end after timeout when tool outputs never arrive", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  delete process.env.CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "2500";
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";

  const lines = [
    { type: "response.started", ts: 1 },
    { type: "response_item", ts: 2, payload: { type: "function_call", name: "tool", call_id: "call_1" } },
    { type: "response.completed", ts: 3 },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 2_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 6_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, undefined);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("turnOpen expires after timeout without explicit end", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "2500";
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";

  const lines = [
    { type: "turn.started", ts: 1 },
    { type: "event_msg", ts: 2, payload: { type: "agent_message", message: "working" } },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 2_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 6_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, undefined);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("open tool call keeps in-flight without new events", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "3000";
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";

  const start = {
    type: "response_item",
    ts: 1,
    payload: {
      type: "function_call",
      name: "mcp__brv__brv-query",
      call_id: "call_1",
      arguments: "{}",
    },
  };
  await fs.writeFile(file, `${JSON.stringify(start)}\n`);

  Date.now = () => 1_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 10_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, true);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("tool call without call_id times out without open calls", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "2500";
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";

  const start = {
    type: "response_item",
    ts: 1,
    payload: {
      type: "function_call",
      arguments: "{}",
    },
  };
  await fs.writeFile(file, `${JSON.stringify(start)}\n`);

  Date.now = () => 1_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  assert.equal(stateStart.openCallIds?.size ?? 0, 0);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 5_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, undefined);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("pending end waits for tool output to finish", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "2500";
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";

  const lines = [
    {
      type: "response_item",
      ts: 1,
      payload: { type: "function_call", name: "tool", call_id: "call_1" },
    },
    { type: "response.completed", ts: 2 },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 2_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  assert.ok(stateStart.pendingEndAt);
  assert.equal(stateStart.inFlight, true);

  const output = {
    type: "response_item",
    ts: 3,
    payload: { type: "function_call_output", call_id: "call_1" },
  };
  await fs.appendFile(file, `${JSON.stringify(output)}\n`);

  Date.now = () => 3_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  assert.equal(stateLater.pendingEndAt, undefined);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, undefined);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("tool output without call_id does not retain open call", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "2500";
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";

  const lines = [
    {
      type: "response_item",
      ts: 1,
      payload: { type: "function_call", name: "tool", call_id: "call_1" },
    },
    { type: "response.completed", ts: 2 },
    {
      type: "response_item",
      ts: 3,
      payload: { type: "function_call_output" },
    },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 3_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  assert.equal(stateStart.openCallIds?.size ?? 0, 1);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 10_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  assert.equal(stateLater.openCallIds?.size ?? 0, 0);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, undefined);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("keeps in-flight codex state within timeout window", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS;
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";
  const lines = [
    {
      type: "response.started",
      ts: 1,
    },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 1_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 2_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, true);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("invalid in-flight timeout keeps in-flight within timeout window", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS = "not-a-number";
  delete process.env.CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS;
  process.env.CONSENSUS_CODEX_FILE_FRESH_MS = "0";
  const lines = [
    {
      type: "response.started",
      ts: 1,
    },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 1_000;
  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  Date.now = () => 2_000;
  const stateLater = await updateTail(file);
  assert.ok(stateLater);
  const summaryLater = summarizeTail(stateLater);
  assert.equal(summaryLater.inFlight, true);

  Date.now = originalNow;
  delete process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS;
  delete process.env.CONSENSUS_CODEX_FILE_FRESH_MS;
  await fs.rm(dir, { recursive: true, force: true });
});

test("turn.completed clears in-flight after response completion", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const originalNow = Date.now;
  Date.now = () => 1_000;

  const start = [
    {
      type: "response.started",
      ts: 1,
    },
  ];
  await fs.writeFile(file, `${start.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const stateStart = await updateTail(file);
  assert.ok(stateStart);
  const summaryStart = summarizeTail(stateStart);
  assert.equal(summaryStart.inFlight, true);

  const end = [
    {
      type: "response.completed",
      ts: 2,
    },
    {
      type: "turn.completed",
      ts: 3,
    },
  ];
  await fs.appendFile(file, `${end.map((line) => JSON.stringify(line)).join("\n")}\n`);

  Date.now = () => 3_000;
  const stateEnd = await updateTail(file);
  assert.ok(stateEnd);
  const summaryEnd = summarizeTail(stateEnd);
  assert.equal(summaryEnd.inFlight, undefined);

  Date.now = originalNow;
  await fs.rm(dir, { recursive: true, force: true });
});

test("does not treat response.input_text.delta as in-flight activity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    {
      type: "response.input_text.delta",
      ts: 1,
    },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);
  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, undefined);
  assert.equal(summary.lastActivityAt, undefined);

  await fs.rm(dir, { recursive: true, force: true });
});

test("assistant message does not clear in-flight state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");
  const now = Date.now();

  const lines = [
    {
      type: "response.started",
      ts: now,
    },
    {
      type: "response_item",
      ts: now + 1,
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hi" }],
      },
    },
  ];
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);
  const summary = summarizeTail(state);
  assert.equal(summary.inFlight, true);

  await fs.rm(dir, { recursive: true, force: true });
});

test("skips malformed JSONL lines but preserves surrounding events", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  const lines = [
    JSON.stringify({
      type: "item.completed",
      ts: 1,
      item: { type: "command_execution", command: "npm test" },
    }),
    "{bad-json",
    JSON.stringify({
      type: "item.completed",
      ts: 2,
      item: { type: "assistant_message", content: "ok" },
    }),
  ];

  await fs.writeFile(file, `${lines.join("\n")}\n`);

  const state = await updateTail(file);
  assert.ok(state);

  const summary = summarizeTail(state);
  assert.equal(summary.summary.lastCommand, "cmd: npm test");
  assert.equal(summary.summary.lastMessage, "ok");

  await fs.rm(dir, { recursive: true, force: true });
});
