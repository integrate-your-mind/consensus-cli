import test from "node:test";
import assert from "node:assert/strict";
import { shouldApplyCodexNotifyEnd } from "../../src/scan.ts";

test("notify end does not override tail in-flight", () => {
  const shouldEnd = shouldApplyCodexNotifyEnd({
    tailAllowsNotifyEnd: true,
    notifyEndIsFresh: true,
    tailEndAt: undefined,
    tailInFlight: true,
  });
  assert.equal(shouldEnd, false);
});

test("notify end applies when tail is idle", () => {
  const shouldEnd = shouldApplyCodexNotifyEnd({
    tailAllowsNotifyEnd: true,
    notifyEndIsFresh: true,
    tailEndAt: undefined,
    tailInFlight: false,
  });
  assert.equal(shouldEnd, true);
});

test("notify end does not apply when tail has explicit end", () => {
  const shouldEnd = shouldApplyCodexNotifyEnd({
    tailAllowsNotifyEnd: true,
    notifyEndIsFresh: true,
    tailEndAt: Date.now(),
    tailInFlight: false,
  });
  assert.equal(shouldEnd, false);
});

test("notify end does not apply when tail disallows notify end", () => {
  const shouldEnd = shouldApplyCodexNotifyEnd({
    tailAllowsNotifyEnd: false,
    notifyEndIsFresh: true,
    tailEndAt: undefined,
    tailInFlight: false,
  });
  assert.equal(shouldEnd, false);
});

test("notify end does not apply when notify end is not fresh", () => {
  const shouldEnd = shouldApplyCodexNotifyEnd({
    tailAllowsNotifyEnd: true,
    notifyEndIsFresh: false,
    tailEndAt: undefined,
    tailInFlight: false,
  });
  assert.equal(shouldEnd, false);
});
