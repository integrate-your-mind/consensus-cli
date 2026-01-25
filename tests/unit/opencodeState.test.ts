import test from "node:test";
import assert from "node:assert/strict";
import { deriveOpenCodeState } from "../../src/opencodeState.ts";


test("opencode running status without evidence is idle", () => {
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    now: Date.now(),
  });
  assert.equal(result.state, "idle");
});

test("opencode active when inFlight true", () => {
  const result = deriveOpenCodeState({
    cpu: 0,
    hasError: false,
    status: "running",
    inFlight: true,
    now: Date.now(),
  });
  assert.equal(result.state, "active");
});
