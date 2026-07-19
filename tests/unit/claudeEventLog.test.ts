import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  flushClaudeEventPersistence,
  queueClaudeEventPersistence,
} from "../../src/services/claudeEventLog.js";
import type { ClaudeEvent } from "../../src/claude/types.js";

function event(
  sessionId: string,
  timestamp: number,
  extra: Partial<ClaudeEvent> = {}
): ClaudeEvent {
  return {
    type: "SubagentStart",
    sessionId,
    timestamp,
    agentType: "Explore",
    ...extra,
  } as ClaudeEvent;
}

async function withEventLog(
  run: (directory: string, logPath: string) => Promise<void>
): Promise<void> {
  const previousPath = process.env.CONSENSUS_CLAUDE_EVENT_LOG;
  const previousMax = process.env.CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES;
  const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-claude-log-"));
  const logPath = path.join(directory, "events.jsonl");
  process.env.CONSENSUS_CLAUDE_EVENT_LOG = logPath;

  try {
    await run(directory, logPath);
  } finally {
    await flushClaudeEventPersistence();
    if (previousPath === undefined) {
      delete process.env.CONSENSUS_CLAUDE_EVENT_LOG;
    } else {
      process.env.CONSENSUS_CLAUDE_EVENT_LOG = previousPath;
    }
    if (previousMax === undefined) {
      delete process.env.CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES;
    } else {
      process.env.CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES = previousMax;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

describe("Claude event log", { concurrency: false }, () => {
  it("persists duplicate hook deliveries only once", async () => {
    await withEventLog(async (_directory, logPath) => {
      const duplicate = event("duplicate-session", Date.now());
      void queueClaudeEventPersistence(duplicate);
      void queueClaudeEventPersistence(duplicate);
      await flushClaudeEventPersistence();

      const lines = (await readFile(logPath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      assert.equal(lines.length, 1);
    });
  });

  it("captures the configured path when a write is queued", async () => {
    await withEventLog(async (directory, firstPath) => {
      const secondPath = path.join(directory, "later.jsonl");
      const queued = queueClaudeEventPersistence(
        event("path-session", Date.now())
      );
      process.env.CONSENSUS_CLAUDE_EVENT_LOG = secondPath;
      await queued;

      const first = await readFile(firstPath, "utf8");
      assert.match(first, /path-session/);
      await assert.rejects(() => readFile(secondPath, "utf8"));
    });
  });

  it("enforces the byte limit with multibyte metadata and keeps valid JSON lines", async () => {
    await withEventLog(async (_directory, logPath) => {
      process.env.CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES = String(64 * 1024);
      const now = Date.now();
      const agentType = "🚀".repeat(80);

      for (let index = 0; index < 500; index += 1) {
        void queueClaudeEventPersistence(
          event(`unicode-${index}`, now + index, { agentType })
        );
      }
      await flushClaudeEventPersistence();

      const info = await stat(logPath);
      assert.ok(info.size <= 64 * 1024, `event log was ${info.size} bytes`);
      const lines = (await readFile(logPath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      assert.ok(lines.length > 0);
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line));
      }
    });
  });
});
