import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { updateTail, summarizeTail } from "../../src/codexLogs.ts";

async function setupSessionFile(): Promise<{
  sessionPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "consensus-codex-stale-"));
  const sessionPath = path.join(dir, "session.jsonl");
  await writeFile(sessionPath, "", "utf8");
  return {
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

test("stale session file clears pending-end and open-call markers even when inFlight is false", async () => {
  await withEnv(
    {
      CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS: "100",
      CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS: "0",
      CONSENSUS_CODEX_FILE_FRESH_MS: "0",
      CONSENSUS_CODEX_STALE_FILE_MS: "1",
    },
    async () => {
      const { sessionPath, cleanup } = await setupSessionFile();
      try {
        const state = await updateTail(sessionPath);
        assert.ok(state);

        // Simulate a session that was already marked not-inFlight while still holding
        // deferred-end markers or open calls. These markers should not survive stale cleanup.
        state.inFlight = false;
        state.pendingEndAt = Date.now() - 10;
        state.turnOpen = true;
        state.reviewMode = true;
        state.openCallIds = new Set(["call_1"]);
        state.openItemCount = 1;

        const past = new Date(Date.now() - 5000);
        await utimes(sessionPath, past, past);

        const next = await updateTail(sessionPath);
        assert.ok(next);
        assert.equal(next.pendingEndAt, undefined);
        assert.equal(next.turnOpen, false);
        assert.equal(next.reviewMode, false);
        assert.equal(next.openCallIds?.size ?? 0, 0);
        assert.equal(next.openItemCount ?? 0, 0);
        assert.equal(summarizeTail(next).inFlight, undefined);
      } finally {
        await cleanup();
      }
    }
  );
});
