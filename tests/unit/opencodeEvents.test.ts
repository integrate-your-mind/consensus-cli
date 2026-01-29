import test from "node:test";
import assert from "node:assert/strict";
import {
  ingestOpenCodeEvent,
  getOpenCodeActivityByPid,
  getOpenCodeActivityBySession,
  onOpenCodeEvent,
} from "../../src/opencodeEvents.ts";


test("tracks opencode in-flight state from tool execution events", () => {
  const sessionId = "session-123";
  ingestOpenCodeEvent({
    type: "tool.execute.before",
    sessionId,
    ts: 100,
  });

  const started = getOpenCodeActivityBySession(sessionId);
  assert.ok(started);
  assert.equal(started?.inFlight, true);
  assert.equal(started?.lastEventAt, 100000);

  ingestOpenCodeEvent({
    type: "session.idle",
    sessionId,
    ts: 200,
  });

  const idle = getOpenCodeActivityBySession(sessionId);
  assert.ok(idle);
  assert.equal(idle?.inFlight, false);
  assert.equal(idle?.lastEventAt, 200000);
});

test("captures in-flight transitions across tool events", () => {
  const sessionId = "session-456";
  const pid = 4242;
  ingestOpenCodeEvent({
    type: "tool.execute.before",
    status: "running",
    sessionId,
    pid,
    ts: 10,
  });

  const startedSession = getOpenCodeActivityBySession(sessionId);
  const startedPid = getOpenCodeActivityByPid(pid);
  assert.equal(startedSession?.inFlight, true);
  assert.equal(startedPid?.inFlight, true);

  ingestOpenCodeEvent({
    type: "session.idle",
    status: "completed",
    sessionId,
    pid,
    ts: 20,
  });

  const completedSession = getOpenCodeActivityBySession(sessionId);
  const completedPid = getOpenCodeActivityByPid(pid);
  assert.equal(completedSession?.inFlight, false);
  assert.equal(completedPid?.inFlight, false);
});

test("captures summaries and marks assistant output as activity", () => {
  const sessionId = "session-789";
  ingestOpenCodeEvent({
    type: "command",
    command: "npm run build",
    sessionId,
    ts: 1,
  });
  ingestOpenCodeEvent({
    type: "tool",
    tool_name: "read_file",
    sessionId,
    ts: 2,
  });
  ingestOpenCodeEvent({
    type: "prompt",
    prompt: "hello world",
    role: "user",
    sessionId,
    ts: 3,
  });
  ingestOpenCodeEvent({
    type: "message",
    message: "done",
    role: "assistant",
    sessionId,
    ts: 4,
  });

  const activity = getOpenCodeActivityBySession(sessionId);
  assert.ok(activity);
  assert.equal(activity?.summary?.lastCommand, "cmd: npm run build");
  assert.equal(activity?.summary?.lastTool, "tool: read_file");
  assert.equal(activity?.summary?.lastPrompt, "prompt: hello world");
  assert.equal(activity?.summary?.lastMessage, "done");
  assert.equal(activity?.summary?.lastMessage, "done");
});

test("ignores session metadata for activity", () => {
  const sessionId = "session-meta";
  ingestOpenCodeEvent({
    type: "session.opened",
    sessionId,
  });

  const activity = getOpenCodeActivityBySession(sessionId);
  assert.ok(activity);
  assert.equal(activity?.lastActivityAt, undefined);
  assert.equal(typeof activity?.lastEventAt, "number");
});

test("notifies listeners when events are ingested", () => {
  let calls = 0;
  const unsubscribe = onOpenCodeEvent(() => {
    calls += 1;
  });

  ingestOpenCodeEvent({
    type: "message",
    message: "hi",
    sessionId: "session-999",
    ts: 1,
  });

  unsubscribe();
  assert.ok(calls >= 1);
});

test("assistant message does not set in-flight without message.part.updated", () => {
  const sessionId = "session-message-only";
  ingestOpenCodeEvent({
    type: "message",
    message: "hello",
    role: "assistant",
    sessionId,
    ts: 5,
  });
  const activity = getOpenCodeActivityBySession(sessionId);
  assert.ok(activity);
  assert.equal(activity?.inFlight, undefined);
});

test("tui prompt append does not set in-flight", () => {
  const sessionId = "session-tui";
  ingestOpenCodeEvent({
    type: "tui.prompt.append",
    message: "typing",
    role: "user",
    sessionId,
    ts: 6,
  });
  const activity = getOpenCodeActivityBySession(sessionId);
  assert.ok(activity);
  assert.equal(activity?.inFlight, undefined);
});
