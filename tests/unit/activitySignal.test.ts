import test from "node:test";
import assert from "node:assert/strict";
import { getLastSignalAt } from "../../src/activity/signal.ts";

test("getLastSignalAt prefers lastInFlightSignalAt", () => {
  const result = getLastSignalAt({
    lastInFlightSignalAt: 3000,
    lastActivityAt: 2000,
    lastEventAt: 1000,
    lastSeenAt: 500,
  });
  assert.equal(result, 3000);
});

test("getLastSignalAt falls back to lastActivityAt then lastEventAt", () => {
  const result = getLastSignalAt({
    lastActivityAt: 2000,
    lastEventAt: 1500,
    lastSeenAt: 1000,
  });
  assert.equal(result, 2000);
});
