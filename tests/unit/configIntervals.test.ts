import test from "node:test";
import assert from "node:assert/strict";
import { resolveOpenCodeTimeoutMs, resolvePollMs } from "../../src/config/intervals.ts";

test("resolvePollMs defaults to 250 and clamps to min 50", () => {
  assert.equal(resolvePollMs({} as NodeJS.ProcessEnv), 250);
  assert.equal(resolvePollMs({ CONSENSUS_POLL_MS: "" } as NodeJS.ProcessEnv), 250);
  assert.equal(resolvePollMs({ CONSENSUS_POLL_MS: "0" } as NodeJS.ProcessEnv), 50);
  assert.equal(resolvePollMs({ CONSENSUS_POLL_MS: "10" } as NodeJS.ProcessEnv), 50);
  assert.equal(resolvePollMs({ CONSENSUS_POLL_MS: "250" } as NodeJS.ProcessEnv), 250);
});

test("resolveOpenCodeTimeoutMs defaults to 5000 when unset", () => {
  assert.equal(resolveOpenCodeTimeoutMs({} as NodeJS.ProcessEnv), 5000);
  assert.equal(
    resolveOpenCodeTimeoutMs({ CONSENSUS_OPENCODE_TIMEOUT_MS: "" } as NodeJS.ProcessEnv),
    5000
  );
});

