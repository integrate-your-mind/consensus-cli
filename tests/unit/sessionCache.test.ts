import test from "node:test";
import assert from "node:assert/strict";
import { resetSessionCachesOnRestart } from "../../src/sessionCache.ts";

test("resetSessionCachesOnRestart clears caches on start mismatch", () => {
  const activityCache = new Map<string, { startMs?: number }>([
    ["123", { startMs: 1000 }],
  ]);
  const sessionCache = new Map<number, { sessionId: string; lastSeenAt: number }>([
    [123, { sessionId: "s1", lastSeenAt: 0 }],
  ]);

  const changed = resetSessionCachesOnRestart({
    pid: 123,
    cachedStartMs: 1000,
    currentStartMs: 3000,
    activityCache,
    sessionCache,
    epsilonMs: 1000,
  });

  assert.equal(changed, true);
  assert.equal(activityCache.has("123"), false);
  assert.equal(sessionCache.has(123), false);
});

test("resetSessionCachesOnRestart leaves caches when start is stable", () => {
  const activityCache = new Map<string, { startMs?: number }>([
    ["123", { startMs: 1000 }],
  ]);
  const sessionCache = new Map<number, { sessionId: string; lastSeenAt: number }>([
    [123, { sessionId: "s1", lastSeenAt: 0 }],
  ]);

  const changed = resetSessionCachesOnRestart({
    pid: 123,
    cachedStartMs: 1000,
    currentStartMs: 1500,
    activityCache,
    sessionCache,
    epsilonMs: 1000,
  });

  assert.equal(changed, false);
  assert.equal(activityCache.has("123"), true);
  assert.equal(sessionCache.has(123), true);
});
