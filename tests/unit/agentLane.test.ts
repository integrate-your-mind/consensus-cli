import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSnapshot } from "../../public/src/types";
import { sortAgentsForLane } from "../../public/src/lib/agents";

const makeAgent = (overrides: Partial<AgentSnapshot>): AgentSnapshot => ({
  identity: overrides.identity ?? `id:${overrides.id ?? "x"}`,
  id: overrides.id ?? "x",
  pid: overrides.pid ?? 1,
  cmd: overrides.cmd ?? "codex",
  cmdShort: overrides.cmdShort ?? "codex",
  kind: overrides.kind ?? "tui",
  cpu: overrides.cpu ?? 0,
  mem: overrides.mem ?? 0,
  state: overrides.state ?? "idle",
  ...overrides,
});

test("sortAgentsForLane groups active above inactive and orders by activity time", () => {
  const agents = [
    makeAgent({ id: "idle-old", identity: "id:idle-old", state: "idle", lastActivityAt: 100 }),
    makeAgent({ id: "active-new", identity: "id:active-new", state: "active", lastActivityAt: 200 }),
    makeAgent({ id: "active-old", identity: "id:active-old", state: "active", lastActivityAt: 150 }),
    makeAgent({ id: "idle-new", identity: "id:idle-new", state: "idle", lastActivityAt: 300 }),
  ];
  const sorted = sortAgentsForLane(agents);
  assert.deepEqual(
    sorted.map((agent) => agent.identity),
    ["id:active-new", "id:active-old", "id:idle-new", "id:idle-old"]
  );
});

test("sortAgentsForLane falls back to lastEventAt/startedAt and identity", () => {
  const agents = [
    makeAgent({ id: "b", identity: "id:b", state: "active", lastEventAt: 20 }),
    makeAgent({ id: "a", identity: "id:a", state: "active", lastEventAt: 10 }),
    makeAgent({ id: "c", identity: "id:c", state: "idle", startedAt: 30 }),
    makeAgent({ id: "d", identity: "id:d", state: "idle", startedAt: 30 }),
  ];
  const sorted = sortAgentsForLane(agents);
  assert.deepEqual(
    sorted.map((agent) => agent.identity),
    ["id:b", "id:a", "id:c", "id:d"]
  );
});
