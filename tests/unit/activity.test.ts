import test from "node:test";
import assert from "node:assert/strict";
import { deriveState } from "../../src/activity.ts";

test("marks active when recent event exists", () => {
  const now = Date.now();
  const state = deriveState({ cpu: 0.1, hasError: false, lastEventAt: now - 1000, now });
  assert.equal(state, "active");
});

test("marks idle when no recent activity", () => {
  const now = Date.now();
  const state = deriveState({ cpu: 0.1, hasError: false, lastEventAt: now - 20000, now });
  assert.equal(state, "idle");
});

test("marks error when hasError true", () => {
  const state = deriveState({ cpu: 20, hasError: true, lastEventAt: Date.now() });
  assert.equal(state, "error");
});
