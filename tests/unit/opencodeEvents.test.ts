import test from "node:test";
import assert from "node:assert/strict";
import { ingestOpenCodeEvent, getOpenCodeActivityBySession } from "../../src/opencodeEvents.ts";


test("tracks opencode in-flight state without summaries", () => {
  const sessionId = "session-123";
  ingestOpenCodeEvent({
    type: "event",
    status: "started",
    sessionId,
    ts: 100,
  });

  const started = getOpenCodeActivityBySession(sessionId);
  assert.ok(started);
  assert.equal(started?.inFlight, true);
  assert.equal(started?.lastEventAt, 100000);

  ingestOpenCodeEvent({
    type: "event",
    status: "idle",
    sessionId,
    ts: 200,
  });

  const idle = getOpenCodeActivityBySession(sessionId);
  assert.ok(idle);
  assert.equal(idle?.inFlight, false);
  assert.equal(idle?.lastEventAt, 200000);
});
