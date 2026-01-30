import test from "node:test";
import assert from "node:assert/strict";
import { mergeLastActiveAt } from "../../src/activity/cache.js";

test("mergeLastActiveAt keeps cached value when next is undefined", () => {
  const result = mergeLastActiveAt(undefined, 1234);
  assert.equal(result, 1234);
});

test("mergeLastActiveAt prefers next value when defined", () => {
  const result = mergeLastActiveAt(5678, 1234);
  assert.equal(result, 5678);
});

test("mergeLastActiveAt returns undefined when both values missing", () => {
  const result = mergeLastActiveAt(undefined, undefined);
  assert.equal(result, undefined);
});
