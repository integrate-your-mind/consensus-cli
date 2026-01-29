import test from "node:test";
import assert from "node:assert/strict";
import { dedupeAgents } from "../../src/dedupe.ts";

test("dedupeAgents keeps separate agents per PID even when session path matches", () => {
  const result = dedupeAgents([
    {
      id: "1",
      pid: 1,
      identity: "codex:session-1",
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 0,
      mem: 10,
      state: "idle",
      sessionPath: "session-a",
      lastEventAt: 1,
    },
    {
      id: "2",
      pid: 2,
      identity: "codex:session-2",
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 2,
      mem: 11,
      state: "active",
      sessionPath: "session-a",
      lastEventAt: 2,
    },
  ]);

  assert.equal(result.length, 2);
  const pids = result.map((agent) => agent.pid).sort((a, b) => a - b);
  assert.deepEqual(pids, [1, 2]);
});

test("dedupeAgents collapses agents that share an identity across pids", () => {
  const result = dedupeAgents([
    {
      id: "1",
      pid: 1,
      identity: "codex:session-9",
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 1,
      mem: 10,
      state: "idle",
      lastEventAt: 1,
    },
    {
      id: "2",
      pid: 2,
      identity: "codex:session-9",
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 5,
      mem: 11,
      state: "active",
      lastEventAt: 2,
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.pid, 2);
});

test("dedupeAgents keeps most relevant snapshot when PID is duplicated", () => {
  const result = dedupeAgents([
    {
      id: "10",
      pid: 10,
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 0,
      mem: 10,
      state: "idle",
      lastEventAt: 1,
    },
    {
      id: "10",
      pid: 10,
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 5,
      mem: 12,
      state: "active",
      lastEventAt: 2,
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.state, "active");
});

test("dedupeAgents keeps servers separate from agents even with shared identity", () => {
  const result = dedupeAgents([
    {
      id: "10",
      pid: 10,
      identity: "opencode:session-1",
      cmd: "opencode serve",
      cmdShort: "opencode serve",
      kind: "opencode-server",
      cpu: 1,
      mem: 10,
      state: "active",
      sessionPath: "opencode:session-1",
    },
    {
      id: "11",
      pid: 11,
      identity: "opencode:session-1",
      cmd: "opencode",
      cmdShort: "opencode",
      kind: "opencode-tui",
      cpu: 1,
      mem: 10,
      state: "active",
      sessionPath: "opencode:session-1",
    },
  ]);

  assert.equal(result.length, 2);
});

test("dedupeAgents prefers most recent event when duplicates share PID", () => {
  const result = dedupeAgents([
    {
      id: "20",
      pid: 20,
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 10,
      mem: 20,
      state: "active",
      lastEventAt: 100,
    },
    {
      id: "21",
      pid: 20,
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 2,
      mem: 30,
      state: "active",
      lastEventAt: 200,
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "21");
});
