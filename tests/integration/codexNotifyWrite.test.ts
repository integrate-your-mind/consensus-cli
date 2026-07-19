import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";

async function runCodexNotifyScript(input: {
  repoRoot: string;
  codexHome: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const scriptPath = path.join(input.repoRoot, "src", "codexNotify.ts");
  const argvPayload = JSON.stringify(input.payload);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, "", argvPayload],
      {
        cwd: input.repoRoot,
        env: { ...process.env, CONSENSUS_CODEX_HOME: input.codexHome },
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      reject(new Error(`codexNotify.ts exited with code=${code}\n${stderr}`));
    });
  });
}

test("codex notify appends payload to CONSENSUS_CODEX_HOME/consensus/codex-notify.jsonl", async (t) => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "../..");

  const codexHome = await mkdtemp(path.join(os.tmpdir(), "consensus-codex-home-"));
  t.after(async () => {
    await rm(codexHome, { recursive: true, force: true });
  });

  const notifyPath = path.join(codexHome, "consensus", "codex-notify.jsonl");

  const payload1 = {
    type: "turn.started",
    "thread-id": "thread-write",
    "turn-id": "turn-1",
  };
  await runCodexNotifyScript({ repoRoot, codexHome, payload: payload1 });

  const text1 = await readFile(notifyPath, "utf8");
  const lines1 = text1.trimEnd().split("\n");
  assert.equal(lines1.length, 1);
  assert.deepEqual(JSON.parse(lines1[0] || "null"), payload1);

  const payload2 = {
    type: "turn.completed",
    "thread-id": "thread-write",
    "turn-id": "turn-1",
  };
  await runCodexNotifyScript({ repoRoot, codexHome, payload: payload2 });

  const text2 = await readFile(notifyPath, "utf8");
  const lines2 = text2.trimEnd().split("\n");
  assert.equal(lines2.length, 2);
  assert.deepEqual(JSON.parse(lines2[0] || "null"), payload1);
  assert.deepEqual(JSON.parse(lines2[1] || "null"), payload2);
});

