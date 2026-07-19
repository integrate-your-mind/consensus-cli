import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateTail } from "../../src/codexLogs.ts";

test("updateTail sets needsCatchUp and advances offset incrementally for large deltas", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  const file = path.join(dir, "session.jsonl");

  // Make a delta-only file (skipped by shouldParseJsonLine) that exceeds MAX_READ_BYTES.
  // This exercises the "catch up across multiple updates" path without needing to JSON.parse every line.
  const deltaPayload = "x".repeat(1024);
  const line = `{"type":"response.output_text.delta","delta":"${deltaPayload}","ts":0}\n`;
  const minSize = 2 * 1024 * 1024 + 4096;
  const lineBytes = Buffer.byteLength(line, "utf8");
  const lineCount = Math.ceil(minSize / lineBytes);
  await fs.writeFile(file, line.repeat(lineCount), "utf8");

  const stat = await fs.stat(file);
  assert.ok(stat.size > 2 * 1024 * 1024, "fixture file should exceed read cap");

  const first = await updateTail(file);
  assert.ok(first, "tail state should be returned");
  assert.equal(first.needsCatchUp, true);
  assert.ok(typeof first.lastIngestAt === "number");
  assert.ok(first.offset > 0);
  assert.ok(first.offset < stat.size);

  const second = await updateTail(file);
  assert.ok(second, "tail state should still be returned");
  const stat2 = await fs.stat(file);
  assert.equal(second.needsCatchUp, false);
  assert.equal(second.offset, stat2.size);

  await fs.rm(dir, { recursive: true, force: true });
});

