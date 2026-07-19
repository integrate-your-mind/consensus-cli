import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setupCodexHook } from "../../src/cli/setup.js";

test("setupCodexHook inserts notifications inside existing [tui] block", async () => {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  process.env.HOME = tempHome;

  const codexDir = path.join(tempHome, ".codex");
  await fs.mkdir(codexDir, { recursive: true });
  const configPath = path.join(codexDir, "config.toml");
  const existing = [
    "[tui]",
    "theme = \"dark\"",
    "",
    "[other]",
    "value = 1",
    "",
  ].join("\n");
  await fs.writeFile(configPath, existing, "utf-8");

  await setupCodexHook();
  const updated = await fs.readFile(configPath, "utf-8");

  const tuiIndex = updated.indexOf("[tui]");
  const otherIndex = updated.indexOf("[other]");
  const notificationsIndex = updated.indexOf("notifications =");

  assert.ok(tuiIndex !== -1);
  assert.ok(notificationsIndex !== -1);
  assert.ok(otherIndex !== -1);
  assert.ok(notificationsIndex > tuiIndex && notificationsIndex < otherIndex);

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

test("setupCodexHook merges required notifications into an existing notifications line", async () => {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "consensus-"));
  process.env.HOME = tempHome;

  const codexDir = path.join(tempHome, ".codex");
  await fs.mkdir(codexDir, { recursive: true });
  const configPath = path.join(codexDir, "config.toml");
  const existing = [
    "[tui]",
    "notifications = [\"approval-requested\", \"custom-event\"]",
    "theme = \"dark\"",
    "",
  ].join("\n");
  await fs.writeFile(configPath, existing, "utf-8");

  await setupCodexHook();
  const updated = await fs.readFile(configPath, "utf-8");

  const notificationsLines = updated
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("notifications ="));
  assert.equal(notificationsLines.length, 1);
  const merged = notificationsLines[0] ?? "";
  assert.ok(merged.includes("\"custom-event\""));
  assert.ok(merged.includes("\"approval-requested\""));
  assert.ok(merged.includes("\"agent-turn-complete\""));

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});
