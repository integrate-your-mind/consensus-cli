import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadSnapshot,
  MAX_SNAPSHOT_BYTES,
  parseSnapshot,
} from "../../src/cli/graph.js";
import type { SnapshotPayload } from "../../src/types.js";

const validSnapshot: SnapshotPayload = {
  ts: 1_000,
  agents: [
    {
      identity: "/Users/alice/.codex/sessions/secret.jsonl",
      id: "101",
      pid: 101,
      startedAt: 100,
      lastEventAt: 900,
      lastActivityAt: 900,
      activityReason: "tail_event",
      cmd: "codex",
      cmdShort: "codex",
      kind: "tui",
      cpu: 0,
      mem: 100,
      state: "idle",
      summary: {
        current: "message",
        lastMessage: "message",
      },
      events: [
        {
          ts: 900,
          type: "user_message",
          summary: "prompt: test",
          turnId: 7,
        },
      ],
    },
  ],
};

describe("graph CLI snapshot contract", () => {
  it("accepts a valid snapshot and numeric turn ids", () => {
    assert.deepEqual(
      parseSnapshot(JSON.stringify(validSnapshot), "test"),
      validSnapshot
    );
  });

  it("rejects invalid JSON", () => {
    assert.throws(
      () => parseSnapshot("{", "test"),
      /invalid snapshot JSON from test/
    );
  });

  it("rejects oversized snapshot text before JSON parsing", () => {
    const oversized = " ".repeat(MAX_SNAPSHOT_BYTES + 1);
    assert.throws(
      () => parseSnapshot(oversized, "test"),
      /snapshot from test exceeds/
    );
  });

  it("rejects malformed agent records", () => {
    const malformed = {
      ...validSnapshot,
      agents: [{ ...validSnapshot.agents[0], state: "running" }],
    };
    assert.throws(
      () => parseSnapshot(JSON.stringify(malformed), "test"),
      /invalid snapshot payload from test/
    );
  });

  it("rejects malformed retained events", () => {
    const malformed = {
      ...validSnapshot,
      agents: [
        {
          ...validSnapshot.agents[0],
          events: [{ ts: "yesterday", type: "message", summary: "message" }],
        },
      ],
    };
    assert.throws(
      () => parseSnapshot(JSON.stringify(malformed), "test"),
      /invalid snapshot payload from test/
    );
  });

  it("rejects non-finite and negative timestamps", () => {
    assert.throws(
      () => parseSnapshot('{"ts":1e400,"agents":[]}', "test"),
      /invalid snapshot payload from test/
    );
    assert.throws(
      () =>
        parseSnapshot(
          JSON.stringify({ ...validSnapshot, ts: -1 }),
          "test"
        ),
      /invalid snapshot payload from test/
    );
    assert.throws(
      () =>
        parseSnapshot(
          JSON.stringify({
            ...validSnapshot,
            agents: [{ ...validSnapshot.agents[0], lastEventAt: null }],
          }),
          "test"
        ),
      /invalid snapshot payload from test/
    );
  });

  it("rejects invalid process metrics", () => {
    for (const patch of [
      { pid: 1.5 },
      { pid: -1 },
      { cpu: -0.1 },
      { mem: -1 },
    ]) {
      assert.throws(
        () =>
          parseSnapshot(
            JSON.stringify({
              ...validSnapshot,
              agents: [{ ...validSnapshot.agents[0], ...patch }],
            }),
            "test"
          ),
        /invalid snapshot payload from test/
      );
    }
  });

  it("rejects terminal control characters in exported labels", () => {
    const malformedTitle = {
      ...validSnapshot,
      agents: [{ ...validSnapshot.agents[0], title: "worker\u001b[2J" }],
    };
    const malformedEvent = {
      ...validSnapshot,
      agents: [
        {
          ...validSnapshot.agents[0],
          events: [{ ts: 900, type: "message\nforged", summary: "message" }],
        },
      ],
    };

    assert.throws(
      () => parseSnapshot(JSON.stringify(malformedTitle), "test"),
      /invalid snapshot payload from test/
    );
    assert.throws(
      () => parseSnapshot(JSON.stringify(malformedEvent), "test"),
      /invalid snapshot payload from test/
    );
  });

  it("rejects unbounded retained event arrays", () => {
    const event = { ts: 900, type: "message", summary: "message" };
    const malformed = {
      ...validSnapshot,
      agents: [
        {
          ...validSnapshot.agents[0],
          events: Array.from({ length: 10_001 }, () => event),
        },
      ],
    };

    assert.throws(
      () => parseSnapshot(JSON.stringify(malformed), "test"),
      /invalid snapshot payload from test/
    );
  });

  it("disables OpenCode autostart during live graph scans and restores the environment", async () => {
    const previous = process.env.CONSENSUS_OPENCODE_AUTOSTART;
    process.env.CONSENSUS_OPENCODE_AUTOSTART = "1";
    let valueDuringLoad: string | undefined;
    let valueDuringScan: string | undefined;

    try {
      const snapshot = await loadSnapshot(undefined, async () => {
        valueDuringLoad = process.env.CONSENSUS_OPENCODE_AUTOSTART;
        return {
          scanCodexProcesses: async () => {
            valueDuringScan = process.env.CONSENSUS_OPENCODE_AUTOSTART;
            return validSnapshot;
          },
        };
      });

      assert.equal(snapshot, validSnapshot);
      assert.equal(valueDuringLoad, "0");
      assert.equal(valueDuringScan, "0");
      assert.equal(process.env.CONSENSUS_OPENCODE_AUTOSTART, "1");
    } finally {
      if (previous === undefined) {
        delete process.env.CONSENSUS_OPENCODE_AUTOSTART;
      } else {
        process.env.CONSENSUS_OPENCODE_AUTOSTART = previous;
      }
    }
  });

  it("restores an unset autostart environment after a live scan", async () => {
    const previous = process.env.CONSENSUS_OPENCODE_AUTOSTART;
    delete process.env.CONSENSUS_OPENCODE_AUTOSTART;

    try {
      await loadSnapshot(undefined, async () => ({
        scanCodexProcesses: async () => validSnapshot,
      }));
      assert.equal(process.env.CONSENSUS_OPENCODE_AUTOSTART, undefined);
    } finally {
      if (previous !== undefined) {
        process.env.CONSENSUS_OPENCODE_AUTOSTART = previous;
      }
    }
  });
});
