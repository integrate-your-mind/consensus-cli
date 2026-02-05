import test from "node:test";
import assert from "node:assert/strict";
import { CodexLifecycleGraph } from "../../src/codex/lifecycleGraph.js";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prior: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("lifecycle graph tracks open tool calls", () => {
  const graph = new CodexLifecycleGraph();
  const threadId = "thread-tools";

  graph.ingestToolStart(threadId, "call_1", 1000, 1000);
  let snap = graph.getThreadSnapshot(threadId, 1000);
  assert.equal(snap?.openCallCount, 1);
  assert.equal(snap?.inFlight, true);
  assert.equal(snap?.reason, "tool_open");

  graph.ingestToolEnd(threadId, "call_1", 1100, 1100);
  snap = graph.getThreadSnapshot(threadId, 1100);
  assert.equal(snap?.openCallCount, 0);
  assert.equal(snap?.inFlight, true);
  assert.equal(snap?.reason, "turn_open");
});

test("pending end finalizes only after grace and no open calls", () => {
  withEnv(
    {
      CONSENSUS_CODEX_INFLIGHT_GRACE_MS: "1000",
      CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS: "2500",
    },
    () => {
      const graph = new CodexLifecycleGraph();
      const threadId = "thread-pending-end";

      graph.ingestAgentStart(threadId, 1000, 1000);
      graph.ingestAgentStop(threadId, 2000, 2000);

      const pending = graph.getThreadSnapshot(threadId, 2500);
      assert.equal(pending?.inFlight, true);
      assert.equal(pending?.reason, "pending_end");
      assert.equal(pending?.endedAt, undefined);

      const ended = graph.getThreadSnapshot(threadId, 3100);
      assert.equal(ended?.inFlight, false);
      assert.equal(ended?.reason, "ended");
      assert.equal(ended?.endedAt, 2000);
    }
  );
});
