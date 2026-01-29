import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentStateStore } from "../../src/core/stateStore.ts";
import { ingestCodexSession } from "../../src/activity/codexActivity.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = () => sleep(0);

test("codex stays active during pulses and turns idle quickly after stop", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "rollout.jsonl");
  const store = new AgentStateStore();
  const now = Date.now();

  const startLine = {
    type: "response.output_text.delta",
    ts: now,
    delta: { text: "hi" },
  };
  await fs.writeFile(file, `${JSON.stringify(startLine)}\n`);

  await ingestCodexSession(store, file);
  await flush();
  let snapshot = store.getSnapshot();
  assert.equal(snapshot.agents[0]?.state, "active");

  const pulseEveryMs = 250;
  const durationMs = 1500;
  const pulseStart = Date.now();
  while (Date.now() - pulseStart < durationMs) {
    const line = {
      type: "response.output_text.delta",
      ts: Date.now(),
      delta: { text: "tick" },
    };
    await fs.appendFile(file, `${JSON.stringify(line)}\n`);
    await ingestCodexSession(store, file);
    await flush();
    snapshot = store.getSnapshot();
    assert.equal(snapshot.agents[0]?.state, "active");
    await sleep(pulseEveryMs);
  }

  const endLine = {
    type: "response.completed",
    ts: Date.now(),
  };
  await fs.appendFile(file, `${JSON.stringify(endLine)}\n`);
  await ingestCodexSession(store, file);
  await flush();
  snapshot = store.getSnapshot();
  assert.equal(snapshot.agents[0]?.state, "idle");

  await fs.rm(dir, { recursive: true, force: true });
});
