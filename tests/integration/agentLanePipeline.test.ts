import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSnapshot } from "../../public/src/types";
import {
  normalizeAgents,
  sortAgentsForLane,
} from "../../public/src/lib/agents";

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

test("lane pipeline keeps active above idle after normalize + sort", () => {
  const incoming: AgentSnapshot[] = [
    makeAgent({ id: "1", identity: "id:1", state: "idle", lastActivityAt: 100 }),
    makeAgent({ id: "2", identity: "id:2", state: "active", lastActivityAt: 300 }),
    makeAgent({ id: "3", identity: "id:3", state: "error", lastActivityAt: 200 }),
  ];

  const normalized = normalizeAgents(incoming);
  const sorted = sortAgentsForLane(normalized);

  assert.deepEqual(
    sorted.map((agent) => agent.identity),
    ["id:2", "id:3", "id:1"]
  );
});
