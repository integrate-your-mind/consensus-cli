import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { updateTail, summarizeTail } from "../../src/codexLogs.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const makeEvent = (event: Record<string, unknown>) => `${JSON.stringify(event)}\n`;

async function setupSessionFile(): Promise<{
  dir: string;
  sessionPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "consensus-codex-store-"));
  const sessionPath = path.join(dir, "session.jsonl");
  await writeFile(sessionPath, "", "utf8");
  return {
    dir,
    sessionPath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function withEnv(
  vars: Record<string, string>,
  fn: () => Promise<void> | void
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(restore);
    }
    restore();
    return Promise.resolve();
  } catch (err) {
    restore();
    return Promise.reject(err);
  }
}

test("pending end expires when no new signals arrive (jsonl tail SSOT)", async () => {
  await withEnv(
    {
      CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS: "60",
      CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS: "0",
      CONSENSUS_CODEX_FILE_FRESH_MS: "0",
      CONSENSUS_CODEX_STALE_FILE_MS: "0",
    },
    async () => {
      const { sessionPath, cleanup } = await setupSessionFile();
      try {
        const base = Date.now();
        await appendFile(
          sessionPath,
          makeEvent({ type: "turn.started", ts: base }) +
            makeEvent({ type: "turn.completed", ts: base + 1 }),
          "utf8"
        );

        const first = await updateTail(sessionPath);
        assert.ok(first);
        assert.equal(typeof first.pendingEndAt, "number");
        assert.equal(summarizeTail(first).inFlight, true);

        await sleep(140);
        const second = await updateTail(sessionPath);
        assert.ok(second);
        assert.equal(second.pendingEndAt, undefined);
        assert.equal(summarizeTail(second).inFlight, undefined);
      } finally {
        await cleanup();
      }
    }
  );
});
