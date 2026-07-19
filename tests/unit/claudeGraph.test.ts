import { createHash } from "crypto";
import { appendFile, mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { describe, it } from "node:test";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { attachClaudeEvents } from "../../src/claudeSnapshot.js";
import { buildAgentGraph } from "../../src/graph.js";
import {
  flushClaudeEventPersistence,
  getClaudeActivityByCwd,
  getClaudeActivityBySession,
  handleClaudeEventEffect,
  hydrateClaudeEventsFromDisk,
} from "../../src/services/claudeEvents.js";
import type { ClaudeEvent } from "../../src/claude/types.js";
import type { SnapshotPayload } from "../../src/types.js";

async function send(
  sessionId: string,
  timestamp: number,
  type: string,
  extra: Partial<ClaudeEvent> = {}
): Promise<void> {
  await Effect.runPromise(
    handleClaudeEventEffect({
      type,
      sessionId,
      timestamp,
      cwd: "/tmp/project",
      ...extra,
    } as ClaudeEvent)
  );
}

function cwdKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

describe("Claude graph events", () => {
  it("retains metadata-only hook history and builds prompt/model/tool phases", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-claude-"));
    const logPath = path.join(directory, "events.jsonl");
    process.env.CONSENSUS_CLAUDE_EVENT_LOG = logPath;
    const now = Date.now();
    const sessionId = `claude-test-${now}-a`;

    await send(sessionId, now, "UserPromptSubmit");
    await send(sessionId, now + 1, "UserPromptExpansion");
    await send(sessionId, now + 2, "MessageDisplay", { final: false });
    await send(sessionId, now + 3, "MessageDisplay", { final: true });
    await send(sessionId, now + 4, "PreToolUse", { toolName: "Bash" });
    await send(sessionId, now + 5, "PostToolUse", { toolName: "Bash" });
    await send(sessionId, now + 6, "SubagentStart", { agentType: "Explore" });
    await send(sessionId, now + 7, "SubagentStop", { agentType: "Explore" });

    const beforeStop = getClaudeActivityBySession(sessionId, now + 7);
    assert.equal(beforeStop?.inFlight, true);

    await send(sessionId, now + 8, "Stop");
    await flushClaudeEventPersistence();
    const state = getClaudeActivityBySession(sessionId, now + 8);
    assert.equal(state?.inFlight, false);
    assert.deepEqual(
      state?.events.map((entry) => entry.type),
      [
        "UserPromptSubmit",
        "MessageDisplay",
        "PreToolUse",
        "PostToolUse",
        "SubagentStart",
        "SubagentStop",
        "Stop",
      ]
    );
    assert.equal(state?.summary.lastPrompt, "prompt");
    assert.equal(state?.summary.lastMessage, "message");
    assert.equal(state?.summary.lastTool, "tool: subagent Explore");

    const snapshot: SnapshotPayload = {
      ts: now + 8,
      agents: [
        {
          identity: `claude:${sessionId}`,
          id: "55",
          pid: 55,
          cmd: "claude",
          cmdShort: "claude",
          kind: "claude-tui",
          cpu: 0,
          mem: 0,
          state: "idle",
          cwd: "/tmp/project",
          sessionPath: `claude:${sessionId}`,
        },
      ],
    };
    const enriched = attachClaudeEvents(snapshot);
    assert.equal(enriched.agents[0].events?.length, 7);

    const graph = buildAgentGraph(enriched);
    assert.deepEqual(
      graph.nodes
        .filter((node) => node.kind === "step")
        .map((node) => node.phase)
        .sort(),
      ["model", "prompt", "tool"]
    );

    const persisted = await readFile(logPath, "utf8");
    assert.ok(!persisted.includes("/tmp/project"));
    assert.ok(!persisted.includes("transcript"));
    assert.ok(!persisted.includes("turn_id"));
    assert.ok(!persisted.includes("message_id"));
    assert.ok(!persisted.includes("tool_input"));
    assert.ok(!persisted.includes("delta"));

    delete process.env.CONSENSUS_CLAUDE_EVENT_LOG;
    await rm(directory, { recursive: true, force: true });
  });

  it("hydrates a fresh session from the bounded metadata log by opaque cwd key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-claude-"));
    const logPath = path.join(directory, "events.jsonl");
    process.env.CONSENSUS_CLAUDE_EVENT_LOG = logPath;
    const now = Date.now();
    const sessionId = `persisted-${now}`;
    const cwd = "/Users/private/work/project";
    const stored = [
      {
        version: 1,
        type: "UserPromptSubmit",
        sessionId,
        timestamp: now,
        cwdKey: cwdKey(cwd),
      },
      {
        version: 1,
        type: "MessageDisplay",
        sessionId,
        timestamp: now + 1,
        cwdKey: cwdKey(cwd),
        final: true,
      },
      {
        version: 1,
        type: "Stop",
        sessionId,
        timestamp: now + 2,
        cwdKey: cwdKey(cwd),
      },
    ];
    await appendFile(logPath, `${stored.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

    await hydrateClaudeEventsFromDisk();
    const state = getClaudeActivityByCwd(cwd, now + 2);
    assert.equal(state?.sessionId, sessionId);
    assert.deepEqual(state?.events.map((entry) => entry.type), [
      "UserPromptSubmit",
      "MessageDisplay",
      "Stop",
    ]);
    assert.equal(state?.cwd, undefined);
    assert.equal(state?.cwdKey, cwdKey(cwd));

    delete process.env.CONSENSUS_CLAUDE_EVENT_LOG;
    await rm(directory, { recursive: true, force: true });
  });

  it("marks StopFailure as a session error without storing error details", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-claude-"));
    const logPath = path.join(directory, "events.jsonl");
    process.env.CONSENSUS_CLAUDE_EVENT_LOG = logPath;
    const now = Date.now();
    const sessionId = `claude-test-${now}-b`;
    await send(sessionId, now, "UserPromptSubmit");
    await send(sessionId, now + 1, "StopFailure");
    await flushClaudeEventPersistence();
    const state = getClaudeActivityBySession(sessionId, now + 1);
    assert.equal(state?.inFlight, false);
    assert.equal(state?.hasError, true);
    assert.equal(state?.events.at(-1)?.summary, "event: StopFailure");
    const persisted = await readFile(logPath, "utf8");
    assert.ok(!persisted.includes("error_details"));

    delete process.env.CONSENSUS_CLAUDE_EVENT_LOG;
    await rm(directory, { recursive: true, force: true });
  });
});
