import test from "node:test";
import assert from "node:assert/strict";
import { resolveOpenCodeInFlight } from "../../src/opencodeInFlight.ts";

test("resolveOpenCodeInFlight prefers SSE when it is newer", () => {
  const result = resolveOpenCodeInFlight({
    sseInFlight: true,
    sseLastActivityAt: 2000,
    apiInFlight: false,
    apiLastActivityAt: 1000,
  });
  assert.equal(result.inFlight, true);
  assert.equal(result.source, "sse");
});

test("resolveOpenCodeInFlight prefers API when it is newer", () => {
  const result = resolveOpenCodeInFlight({
    sseInFlight: true,
    sseLastActivityAt: 1000,
    apiInFlight: false,
    apiLastActivityAt: 2000,
  });
  assert.equal(result.inFlight, false);
  assert.equal(result.source, "api");
});

test("resolveOpenCodeInFlight falls back to SSE when API is missing", () => {
  const result = resolveOpenCodeInFlight({
    sseInFlight: true,
    sseLastActivityAt: 1500,
  });
  assert.equal(result.inFlight, true);
  assert.equal(result.source, "sse");
});
