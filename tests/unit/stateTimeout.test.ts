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
  const dir = await mkdtemp(path.join(os.tmpdir(), "consensus-codex-timeout-"));
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

function withEnv(vars: Record<string, string>, fn: () => Promise<void> | void): Promise<void> {
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

test("pendingEnd clears when tool output arrives before timeout", async () => {
  await withEnv(
    {
      CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS: "100",
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
            makeEvent({ type: "response.completed", ts: base + 1 }),
          "utf8"
        );

        const first = await updateTail(sessionPath);
        assert.ok(first);
        assert.equal(typeof first.pendingEndAt, "number");

        await appendFile(
          sessionPath,
          makeEvent({
            type: "response_item",
            ts: base + 2,
            payload: { type: "response.function_call_output", call_id: "call_1" },
          }),
          "utf8"
        );

        const second = await updateTail(sessionPath);
        assert.ok(second);
        assert.equal(second.pendingEndAt, undefined);
        assert.equal(summarizeTail(second).inFlight, true);
      } finally {
        await cleanup();
      }
    }
  );
});

test("pendingEnd expires when no new signals arrive", async () => {
  await withEnv(
    {
      CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS: "80",
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
            makeEvent({ type: "response.completed", ts: base + 1 }),
          "utf8"
        );

        const first = await updateTail(sessionPath);
        assert.ok(first);
        assert.equal(typeof first.pendingEndAt, "number");
        assert.equal(summarizeTail(first).inFlight, true);

        await sleep(120);
        const second = await updateTail(sessionPath);
        assert.ok(second);
        assert.equal(second.pendingEndAt, undefined);
        assert.equal(summarizeTail(second).inFlight, undefined);
        assert.equal(typeof second.lastEndAt, "number");
      } finally {
        await cleanup();
      }
    }
  );
});

test("pendingEnd does not finalize if tool output lands after timeout but before tick", async () => {
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
            makeEvent({ type: "response.completed", ts: base + 1 }),
          "utf8"
        );

        const first = await updateTail(sessionPath);
        assert.ok(first);
        assert.equal(typeof first.pendingEndAt, "number");

        // Wait beyond timeout; tool output arrives after the grace window but before the next scan tick.
        await sleep(90);
        const toolTs = Date.now();
        await appendFile(
          sessionPath,
          makeEvent({
            type: "response_item",
            ts: toolTs,
            payload: { type: "response.function_call_output", call_id: "call_2" },
          }),
          "utf8"
        );

        const second = await updateTail(sessionPath);
        assert.ok(second);
        assert.equal(second.pendingEndAt, undefined);
        assert.equal(summarizeTail(second).inFlight, true);
      } finally {
        await cleanup();
      }
    }
  );
});

test("turnOpen suppresses stale timeout until an explicit end marker arrives", async () => {
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
        await appendFile(sessionPath, makeEvent({ type: "turn.started", ts: base }), "utf8");
        const started = await updateTail(sessionPath);
        assert.ok(started);
        assert.equal(started.turnOpen, true);
        assert.equal(summarizeTail(started).inFlight, true);

        // Even after the timeout window, we stay in-flight while turnOpen=true.
        await sleep(120);
        const stillOpen = await updateTail(sessionPath);
        assert.ok(stillOpen);
        assert.equal(stillOpen.turnOpen, true);
        assert.equal(summarizeTail(stillOpen).inFlight, true);

        // Once we see an explicit end marker and it ages out, in-flight can finalize.
        const endTs = Date.now();
        await appendFile(sessionPath, makeEvent({ type: "turn.completed", ts: endTs }), "utf8");
        const pending = await updateTail(sessionPath);
        assert.ok(pending);
        assert.equal(pending.turnOpen, false);
        assert.equal(typeof pending.pendingEndAt, "number");

        await sleep(120);
        const ended = await updateTail(sessionPath);
        assert.ok(ended);
        assert.equal(summarizeTail(ended).inFlight, undefined);
      } finally {
        await cleanup();
      }
    }
  );
});

