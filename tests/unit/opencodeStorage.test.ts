import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getOpenCodeSessionForDirectory } from "../../src/opencodeStorage.ts";

test("resolves latest OpenCode session for a directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-opencode-"));
  const projectDir = path.join(root, "storage", "project");
  const sessionDir = path.join(root, "storage", "session", "proj_1");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(sessionDir, { recursive: true });

  const worktree = path.join(root, "workspace");
  await fs.mkdir(worktree, { recursive: true });

  await fs.writeFile(
    path.join(projectDir, "proj_1.json"),
    JSON.stringify({ id: "proj_1", worktree, time: { updated: Date.now() } })
  );

  const sessionPath = path.join(sessionDir, "ses_test.json");
  await fs.writeFile(
    sessionPath,
    JSON.stringify({ id: "ses_test", title: "Storage Session", directory: worktree, time: { updated: 1700000000000 } })
  );

  const session = await getOpenCodeSessionForDirectory(worktree, {
    ...process.env,
    CONSENSUS_OPENCODE_HOME: root,
  });

  assert.ok(session);
  assert.equal(session?.id, "ses_test");
  assert.equal(session?.title, "Storage Session");

  await fs.rm(root, { recursive: true, force: true });
});
