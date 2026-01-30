import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseOpenCodeApiActivityAt } from "../../src/opencodeApiActivity.ts";

test("does not use API activity when status is idle", () => {
  const result = shouldUseOpenCodeApiActivityAt({
    status: "idle",
    apiUpdatedAt: Date.now(),
  });
  assert.equal(result, false);
});

test("uses API activity when status is running and timestamp is present", () => {
  const result = shouldUseOpenCodeApiActivityAt({
    status: "running",
    apiUpdatedAt: Date.now(),
  });
  assert.equal(result, true);
});

test("uses API activity when status is unknown but timestamp is present", () => {
  const result = shouldUseOpenCodeApiActivityAt({
    apiUpdatedAt: Date.now(),
  });
  assert.equal(result, true);
});

test("does not use API activity without timestamps", () => {
  const result = shouldUseOpenCodeApiActivityAt({
    status: "running",
  });
  assert.equal(result, false);
});
