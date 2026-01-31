import test from "node:test";
import assert from "node:assert/strict";
import { groupKeyForAgent, keyForAgent, labelFor } from "../../public/src/lib/format.ts";
import {
  createLayoutState,
  updateLayout,
  debugCellRangeForBounds,
  validateSpatialIndex,
} from "../../public/src/lib/layout.ts";

test("keeps unique layout keys for same repo with different pids", async () => {
  const agentA = { repo: "alpha", id: "101", pid: 101 };
  const agentB = { repo: "alpha", id: "202", pid: 202 };
  assert.equal(groupKeyForAgent(agentA as any), "alpha");
  assert.equal(groupKeyForAgent(agentB as any), "alpha");
  assert.notEqual(keyForAgent(agentA as any), keyForAgent(agentB as any));
});

test("falls back to id when repo is missing to avoid collisions", async () => {
  const agentA = { id: "303", pid: 303 };
  const agentB = { id: "404", pid: 404 };
  assert.equal(groupKeyForAgent(agentA as any), "303");
  assert.equal(groupKeyForAgent(agentB as any), "404");
  assert.notEqual(keyForAgent(agentA as any), keyForAgent(agentB as any));
});

test("labelFor ignores codex titles that look like temp paths", async () => {
  const agent = {
    pid: 505,
    kind: "tui",
    title:
      "/var/folders/79/v8mgm0w50vv5qvv3l3_nvb7h0000gn/T/TemporaryItems/NSIRD_screencaptureui/Screenshot.png",
    repo: "consensus",
  };
  assert.equal(labelFor(agent as any), "consensus");
});

test("labelFor keeps non-codex titles", async () => {
  const agent = {
    pid: 606,
    kind: "opencode-tui",
    title: "OpenCode Work",
    repo: "consensus",
  };
  assert.equal(labelFor(agent as any), "OpenCode Work");
});

test("groupKeyForAgent falls back to cwd then cmd", async () => {
  const repoAgent = { repo: "alpha", cwd: "/tmp/alpha", cmd: "codex", id: "1" };
  const cwdAgent = { cwd: "/tmp/beta", cmd: "codex", id: "2" };
  const cmdAgent = { cmd: "codex exec", id: "3" };
  assert.equal(groupKeyForAgent(repoAgent as any), "alpha");
  assert.equal(groupKeyForAgent(cwdAgent as any), "/tmp/beta");
  assert.equal(groupKeyForAgent(cmdAgent as any), "codex exec");
});

test("layout keeps existing positions when adding agents", async () => {
  const state = createLayoutState();
  const agentA = { id: "101", pid: 101, repo: "alpha", mem: 80_000_000, state: "active" };
  const agentB = { id: "202", pid: 202, repo: "beta", mem: 70_000_000, state: "active" };
  updateLayout(state, [agentA as any, agentB as any]);
  const posA = state.layout.get("101");
  const posB = state.layout.get("202");
  assert.ok(posA);
  assert.ok(posB);

  const agentC = { id: "303", pid: 303, repo: "gamma", mem: 60_000_000, state: "active" };
  updateLayout(state, [agentA as any, agentB as any, agentC as any]);
  assert.deepEqual(state.layout.get("101"), posA);
  assert.deepEqual(state.layout.get("202"), posB);
});

test("group anchor remains stable for same repo", async () => {
  const state = createLayoutState();
  const agentA = { id: "111", pid: 111, repo: "alpha", mem: 80_000_000, state: "active" };
  updateLayout(state, [agentA as any]);
  const anchor = state.groupAnchors.get("alpha");
  assert.ok(anchor);

  const agentB = { id: "112", pid: 112, repo: "alpha", mem: 75_000_000, state: "active" };
  updateLayout(state, [agentA as any, agentB as any]);
  assert.deepEqual(state.groupAnchors.get("alpha"), anchor);
});

test("cellRangeForBounds handles negative and boundary edges", async () => {
  const base = debugCellRangeForBounds({ left: 0, right: 96, top: 0, bottom: 48 });
  assert.deepEqual(base, { minCx: 0, maxCx: 0, minCy: 0, maxCy: 0 });

  const negative = debugCellRangeForBounds({ left: -96, right: 0, top: -48, bottom: 0 });
  assert.deepEqual(negative, { minCx: -1, maxCx: -1, minCy: -1, maxCy: -1 });

  const crossing = debugCellRangeForBounds({ left: -1, right: 96, top: -1, bottom: 48 });
  assert.deepEqual(crossing, { minCx: -1, maxCx: 0, minCy: -1, maxCy: 0 });
});

test("spatial index remains consistent across add/remove", async () => {
  const state = createLayoutState();
  const agentA = { id: "201", pid: 201, repo: "alpha", mem: 80_000_000, state: "active" };
  const agentB = { id: "202", pid: 202, repo: "alpha", mem: 70_000_000, state: "active" };
  const agentC = { id: "203", pid: 203, repo: "beta", mem: 60_000_000, state: "active" };

  updateLayout(state, [agentA as any, agentB as any, agentC as any]);
  validateSpatialIndex(state.spatial);

  updateLayout(state, [agentA as any, agentC as any]);
  validateSpatialIndex(state.spatial);
});
