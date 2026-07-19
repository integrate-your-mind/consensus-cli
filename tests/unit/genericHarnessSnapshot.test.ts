import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attachGenericHarnessProcesses } from "../../src/genericHarnessSnapshot.js";
import { buildAgentGraph } from "../../src/graph.js";
import type { SnapshotPayload } from "../../src/types.js";

const emptySnapshot: SnapshotPayload = {
  ts: 10_000,
  agents: [],
};

describe("generic harness snapshot", () => {
  it("adds process-level agents for detected runtimes", async () => {
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      now: 10_000,
      processes: [
        { pid: 10, name: "openclaw", cmd: "openclaw agent --cwd /tmp/project" },
        { pid: 11, name: "droid", cmd: "droid" },
        { pid: 12, name: "node", cmd: "node server.js" },
      ],
      usage: {
        10: { cpu: 4, memory: 1000, elapsed: 2000 },
        11: { cpu: 0, memory: 2000, elapsed: 1000 },
      },
    });

    assert.equal(snapshot.agents.length, 2);
    const openclaw = snapshot.agents.find((agent) => agent.pid === 10);
    const factory = snapshot.agents.find((agent) => agent.pid === 11);
    assert.equal(openclaw?.kind, "openclaw-cli");
    assert.equal(openclaw?.state, "active");
    assert.equal(openclaw?.repo, "project");
    assert.equal(openclaw?.identity, "openclaw:pid:10");
    assert.equal(factory?.kind, "factory-cli");
    assert.equal(factory?.state, "idle");
  });

  it("does not duplicate a process already represented by a specialized adapter", async () => {
    const snapshot = await attachGenericHarnessProcesses(
      {
        ts: 10_000,
        agents: [
          {
            identity: "codex:session",
            id: "50",
            pid: 50,
            cmd: "codex",
            cmdShort: "codex",
            kind: "tui",
            cpu: 0,
            mem: 0,
            state: "idle",
          },
        ],
      },
      {
        processes: [
          { pid: 50, name: "openclaw", cmd: "openclaw agent" },
        ],
        usage: { 50: { cpu: 9, memory: 1 } },
      }
    );

    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].kind, "tui");
  });

  it("keeps command prompts out of titles and doing summaries", async () => {
    const secret = "private prompt contents";
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      processes: [
        {
          pid: 70,
          name: "cursor-agent",
          cmd: `cursor-agent --print ${secret}`,
        },
      ],
      usage: { 70: { cpu: 0, memory: 0 } },
    });

    const agent = snapshot.agents[0];
    assert.equal(agent.title, "Cursor Agent");
    assert.equal(agent.doing, "Cursor Agent agent");
    assert.equal(agent.title?.includes(secret), false);
    assert.equal(agent.doing?.includes(secret), false);
  });

  it("reports honest process-only coverage in the graph", async () => {
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      processes: [{ pid: 80, name: "gemini", cmd: "gemini" }],
      usage: { 80: { cpu: 0, memory: 0 } },
    });
    const graph = buildAgentGraph(snapshot);

    assert.equal(graph.coverage.providers.gemini.agents, 1);
    assert.equal(graph.coverage.providers.gemini.agentsWithEvents, 0);
    assert.equal(graph.coverage.providers.gemini.history, "unavailable");
    assert.match(
      graph.coverage.providers.gemini.note ?? "",
      /process-level coverage only/i
    );
  });

  it("distinguishes tool integrations from full agent loops", async () => {
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      processes: [{ pid: 90, name: "mmx", cmd: "mmx image generate" }],
      usage: { 90: { cpu: 0, memory: 0 } },
    });
    const graph = buildAgentGraph(snapshot);

    assert.equal(graph.coverage.providers.minimax.history, "unavailable");
    assert.match(
      graph.coverage.providers.minimax.note ?? "",
      /tool\/model integration/i
    );
  });
});
