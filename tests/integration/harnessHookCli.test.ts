import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const hookPath = path.join(repositoryRoot, "src/harnessHook.ts");

async function runHook(
  harnessId: string,
  input: string,
  logPath: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", hookPath, harnessId],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CONSENSUS_HARNESS_EVENT_LOG: logPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  child.stdin.end(input);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  return { code, stdout, stderr };
}

describe("shared harness hook CLI", { concurrency: false }, () => {
  it("acknowledges Gemini with JSON and persists metadata only", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-gemini-hook-"));
    const logPath = path.join(directory, "events.jsonl");
    try {
      const result = await runHook(
        "gemini",
        JSON.stringify({
          hook_event_name: "BeforeTool",
          session_id: "secret-session",
          cwd: "/Users/alice/private-project",
          timestamp: Date.now(),
          tool_name: "write_file",
          prompt: "private prompt",
          tool_input: { path: "/private/file", content: "private content" },
        }),
        logPath
      );

      assert.equal(result.code, 0);
      assert.equal(result.stdout, "{}\n");
      assert.equal(result.stderr, "");
      const persisted = await readFile(logPath, "utf8");
      assert.match(persisted, /"harnessId":"gemini"/);
      assert.match(persisted, /"type":"PreToolUse"/);
      assert.match(persisted, /"toolName":"write_file"/);
      assert.equal(persisted.includes("secret-session"), false);
      assert.equal(persisted.includes("/Users/alice"), false);
      assert.equal(persisted.includes("private prompt"), false);
      assert.equal(persisted.includes("private content"), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("acknowledges malformed Copilot input without writing a record", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-copilot-hook-"));
    const logPath = path.join(directory, "events.jsonl");
    try {
      const result = await runHook("copilot", "{", logPath);
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "{}\n");
      assert.equal(result.stderr, "");
      await assert.rejects(() => readFile(logPath, "utf8"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps passive Claude hook stdout empty", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "consensus-claude-hook-"));
    const logPath = path.join(directory, "events.jsonl");
    try {
      const result = await runHook(
        "claude",
        JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "session",
          timestamp: Date.now(),
        }),
        logPath
      );
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
