import test from "node:test";
import assert from "node:assert/strict";
import { CodexLifecycleGraph } from "../../src/codex/lifecycleGraph.js";

test("lifecycle graph finalizes end after grace window", () => {
  const previousGrace = process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS;
  process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS = "1000";
  try {
    const graph = new CodexLifecycleGraph();
    const threadId = "thread-grace";

    graph.ingestAgentStart(threadId, 1000, 1000);
    graph.ingestNotifyEnd(threadId, 2000, 2000);

    const pending = graph.getThreadSnapshot(threadId, 2500);
    assert.equal(pending?.inFlight, true);
    assert.equal(pending?.endedAt, undefined);

    const ended = graph.getThreadSnapshot(threadId, 3100);
    assert.equal(ended?.inFlight, false);
    assert.equal(ended?.endedAt, 2000);
  } finally {
    if (previousGrace === undefined) {
      delete process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS;
    } else {
      process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS = previousGrace;
    }
  }
});

test("lifecycle graph does not finalize while tools are open", () => {
  const previousGrace = process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS;
  process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS = "0";
  try {
    const graph = new CodexLifecycleGraph();
    const threadId = "thread-tools-open";

    graph.ingestToolStart(threadId, "call_1", 1000, 1000);
    graph.ingestNotifyEnd(threadId, 2000, 2000);
    const pendingWithTool = graph.getThreadSnapshot(threadId, 2000);
    assert.equal(pendingWithTool?.openCallCount, 1);
    assert.equal(pendingWithTool?.inFlight, true);

    graph.ingestToolEnd(threadId, "call_1", 2500, 2500);
    // Simulate a later explicit turn end marker after tool output.
    graph.ingestAgentStop(threadId, 2600, 2600);
    const ended = graph.getThreadSnapshot(threadId, 2600);
    assert.equal(ended?.openCallCount, 0);
    assert.equal(ended?.inFlight, false);
    assert.equal(ended?.endedAt, 2600);
  } finally {
    if (previousGrace === undefined) {
      delete process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS;
    } else {
      process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS = previousGrace;
    }
  }
});
