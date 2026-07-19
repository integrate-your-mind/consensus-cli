import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NormalizedHarnessHookEvent } from "../../src/harnessHookModel.js";
import {
  flushHarnessEventPersistence,
  isStoredHarnessHookEvent,
  queueHarnessEventPersistence,
  readStoredHarnessEvents,
} from "../../src/services/harnessEventLog.js";

function event(
  index: number,
  extra: Partial<NormalizedHarnessHookEvent> = {}
): NormalizedHarnessHookEvent {
  return {
    version: 1,
    harnessId: "kimi",
    type: "PreToolUse",
    sessionKey: index.toString(16).padStart(24, "0").slice(-24),
    timestamp: Date.now() + index,
    toolName: "Bash",
    ...extra,
  };
}

async function withLog(
  run: (directory: string, logPath: string) => Promise<void>
): Promise<void> {
  const previousPath = process.env.CONSENSUS_HARNESS_EVENT_LOG;
  const previousMax = process.env.CONSENSUS_HARNESS_EVENT_LOG_MAX_BYTES;
  const previousTtl = process.env.CONSENSUS_HARNESS_EVENT_TTL_MS;
  const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-harness-log-"));
  const logPath = path.join(directory, "events.jsonl");
  process.env.CONSENSUS_HARNESS_EVENT_LOG = logPath;

  try {
    await run(directory, logPath);
  } finally {
    await flushHarnessEventPersistence();
    if (previousPath === undefined) {
      delete process.env.CONSENSUS_HARNESS_EVENT_LOG;
    } else {
      process.env.CONSENSUS_HARNESS_EVENT_LOG = previousPath;
    }
    if (previousMax === undefined) {
      delete process.env.CONSENSUS_HARNESS_EVENT_LOG_MAX_BYTES;
    } else {
      process.env.CONSENSUS_HARNESS_EVENT_LOG_MAX_BYTES = previousMax;
    }
    if (previousTtl === undefined) {
      delete process.env.CONSENSUS_HARNESS_EVENT_TTL_MS;
    } else {
      process.env.CONSENSUS_HARNESS_EVENT_TTL_MS = previousTtl;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

beforeEach(async () => {
  await flushHarnessEventPersistence();
});

describe("harness event log", { concurrency: false }, () => {
  it("persists duplicate deliveries only once", async () => {
    await withLog(async (_directory, logPath) => {
      const duplicate = event(1);
      void queueHarnessEventPersistence(duplicate);
      void queueHarnessEventPersistence(duplicate);
      await flushHarnessEventPersistence();

      const lines = (await readFile(logPath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      assert.equal(lines.length, 1);
    });
  });

  it("captures the configured path when writes are queued", async () => {
    await withLog(async (directory, firstPath) => {
      const secondPath = path.join(directory, "later.jsonl");
      const queued = queueHarnessEventPersistence(event(2));
      process.env.CONSENSUS_HARNESS_EVENT_LOG = secondPath;
      await queued;

      assert.match(await readFile(firstPath, "utf8"), /PreToolUse/);
      await assert.rejects(() => readFile(secondPath, "utf8"));
    });
  });

  it("enforces UTF-8 byte bounds while retaining complete JSON lines", async () => {
    await withLog(async (_directory, logPath) => {
      process.env.CONSENSUS_HARNESS_EVENT_LOG_MAX_BYTES = String(64 * 1024);
      for (let index = 0; index < 600; index += 1) {
        void queueHarnessEventPersistence(
          event(index + 100, { toolName: "🚀".repeat(80) })
        );
      }
      await flushHarnessEventPersistence();

      const info = await stat(logPath);
      assert.ok(info.size <= 64 * 1024, `log was ${info.size} bytes`);
      const lines = (await readFile(logPath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      assert.ok(lines.length > 0);
      for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
    });
  });

  it("ignores malformed, expired, future-skewed, and duplicate disk records", async () => {
    await withLog(async (_directory, logPath) => {
      process.env.CONSENSUS_HARNESS_EVENT_TTL_MS = "1000";
      const current = event(900);
      const expired = event(901, { timestamp: Date.now() - 2_000 });
      const future = event(902, { timestamp: Date.now() + 10 * 60_000 });
      await appendFile(
        logPath,
        [
          JSON.stringify(current),
          JSON.stringify(current),
          JSON.stringify(expired),
          JSON.stringify(future),
          JSON.stringify({ ...current, sessionKey: "raw-session" }),
          "{",
          "",
        ].join("\n")
      );

      const events = await readStoredHarnessEvents();
      assert.deepEqual(events, [current]);
    });
  });

  it("reads only a bounded complete-line tail from an oversized log", async () => {
    await withLog(async (_directory, logPath) => {
      const current = event(950);
      const oversizedPrefix = "x".repeat(5 * 1024 * 1024);
      await writeFile(
        logPath,
        `${oversizedPrefix}\n${JSON.stringify(current)}\n`,
        "utf8"
      );

      const events = await readStoredHarnessEvents();
      assert.deepEqual(events, [current]);
    });
  });

  it("validates the complete persisted metadata boundary", () => {
    const valid = event(1);
    assert.equal(isStoredHarnessHookEvent(valid), true);
    assert.equal(
      isStoredHarnessHookEvent({ ...valid, harnessId: "unknown" }),
      false
    );
    assert.equal(
      isStoredHarnessHookEvent({ ...valid, timestamp: -1 }),
      false
    );
    assert.equal(
      isStoredHarnessHookEvent({ ...valid, sessionKey: "session-secret" }),
      false
    );
    assert.equal(
      isStoredHarnessHookEvent({ ...valid, toolName: "Bash\nforged" }),
      false
    );
    assert.equal(
      isStoredHarnessHookEvent({
        ...valid,
        harnessId: "copilot",
        type: "ErrorOccurred",
      }),
      true
    );
  });
});
