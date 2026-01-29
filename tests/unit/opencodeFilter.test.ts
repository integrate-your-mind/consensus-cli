import test from "node:test";
import assert from "node:assert/strict";
import { shouldIncludeOpenCodeProcess } from "../../src/opencodeFilter.ts";

test("includes opencode server regardless of session", () => {
  const result = shouldIncludeOpenCodeProcess({
    kind: "opencode-server",
    opencodeApiAvailable: true,
    hasSession: false,
    hasEventActivity: false,
    cpu: 0,
    cpuThreshold: 1,
  });
  assert.equal(result, true);
});

test("includes opencode process without session when api is available", () => {
  const result = shouldIncludeOpenCodeProcess({
    kind: "opencode-tui",
    opencodeApiAvailable: true,
    hasSession: false,
    hasEventActivity: false,
    cpu: 0,
    cpuThreshold: 1,
  });
  assert.equal(result, true);
});

test("includes opencode process when session exists", () => {
  const result = shouldIncludeOpenCodeProcess({
    kind: "opencode-tui",
    opencodeApiAvailable: true,
    hasSession: true,
    hasEventActivity: false,
    cpu: 0,
    cpuThreshold: 1,
  });
  assert.equal(result, true);
});
