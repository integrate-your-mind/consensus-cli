import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachGenericHarnessProcesses,
  resetGenericHarnessProcessCacheForTests,
} from "../../src/genericHarnessSnapshot.js";
import { buildAgentGraph } from "../../src/graph.js";
import { harnessCwdKey, harnessSessionKey } from "../../src/harnessKeys.js";
import type { SnapshotPayload } from "../../src/types.js";

const emptySnapshot: SnapshotPayload = {
  ts: 10_000,
  agents: [],
};

beforeEach(() => {
  resetGenericHarnessProcessCacheForTests();
});

describe("generic harness snapshot", () => {
  it("adds process-level agents for detected runtimes", async () => {
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      now: 10_000,
      processes: [
        {
          pid: 10,
          name: "openclaw",
          cmd: "openclaw agent --cwd /tmp/project --session session-1",
        },
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
    assert.equal(openclaw?.startedAt, 8);
    assert.equal(openclaw?.identity, "openclaw:pid:10:start:8");
    assert.equal(openclaw?.cmd, "openclaw agent");
    assert.equal(openclaw?.cmdShort, "openclaw agent");
    assert.equal(
      openclaw?.harnessCwdKey,
      harnessCwdKey("openclaw", "/tmp/project")
    );
    assert.equal(
      openclaw?.harnessSessionKey,
      harnessSessionKey("openclaw", "session-1")
    );
    assert.equal(factory?.kind, "factory-cli");
    assert.equal(factory?.state, "idle");
  });

  it("clamps impossible process start times instead of exporting negatives", async () => {
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      now: 1_000,
      processes: [{ pid: 15, name: "droid", cmd: "droid" }],
      usage: { 15: { cpu: 0, memory: 0, elapsed: 10_000 } },
    });

    assert.equal(snapshot.agents[0].startedAt, 0);
    assert.equal(snapshot.agents[0].identity, "factory:pid:15:start:0");
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

  it("does not export command prompts or session values", async () => {
    const secret = "private prompt contents";
    const sessionSecret = "session-secret-value";
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      processes: [
        {
          pid: 70,
          name: "cursor-agent",
          cmd: `cursor-agent --print ${secret} --session ${sessionSecret}`,
        },
      ],
      usage: { 70: { cpu: 0, memory: 0 } },
    });

    const agent = snapshot.agents[0];
    const serialized = JSON.stringify(agent);
    assert.equal(agent.title, "Cursor Agent");
    assert.equal(agent.doing, "Cursor Agent agent");
    assert.equal(agent.cmd, "cursor agent");
    assert.equal(agent.cmdShort, "cursor agent");
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(sessionSecret), false);
    assert.match(agent.harnessSessionKey ?? "", /^[a-f0-9]{24}$/);
  });

  it("sanitizes control and bidi characters from exported paths", async () => {
    const snapshot = await attachGenericHarnessProcesses(emptySnapshot, {
      processes: [
        {
          pid: 71,
          name: "droid",
          cmd: "droid --cwd '/tmp/repo\u001b[2J\u202Eevil'",
        },
      ],
      usage: { 71: { cpu: 0, memory: 0 } },
    });
    const serialized = JSON.stringify(snapshot.agents[0]);

    assert.equal(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(
        serialized
      ),
      false
    );
  });

  it("caches generic process and usage discovery for short polling windows", async () => {
    let processLoads = 0;
    let usageLoads = 0;
    const processLoader = async () => {
      processLoads += 1;
      return [{ pid: 72, name: "gemini", cmd: "gemini" }];
    };
    const usageLoader = async () => {
      usageLoads += 1;
      return { 72: { cpu: 0, memory: 0 } };
    };

    const first = await attachGenericHarnessProcesses(emptySnapshot, {
      cacheMs: 1_000,
      processLoader,
      usageLoader,
    });
    const second = await attachGenericHarnessProcesses(emptySnapshot, {
      cacheMs: 1_000,
      processLoader,
      usageLoader,
    });

    assert.equal(first.agents.length, 1);
    assert.equal(second.agents.length, 1);
    assert.equal(processLoads, 1);
    assert.equal(usageLoads, 1);
  });

  it("can disable generic process caching for deterministic refreshes", async () => {
    let processLoads = 0;
    const processLoader = async () => {
      processLoads += 1;
      return [{ pid: 73, name: "copilot", cmd: "copilot" }];
    };
    const usageLoader = async () => ({ 73: { cpu: 0, memory: 0 } });

    await attachGenericHarnessProcesses(emptySnapshot, {
      cacheMs: 0,
      processLoader,
      usageLoader,
    });
    await attachGenericHarnessProcesses(emptySnapshot, {
      cacheMs: 0,
      processLoader,
      usageLoader,
    });

    assert.equal(processLoads, 2);
  });

  it("reports honest hook coverage when no hook history is attached", async () => {
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
      /no retained hook events/i
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
