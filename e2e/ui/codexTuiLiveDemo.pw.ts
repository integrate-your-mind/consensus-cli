import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

async function isCodexAvailable(): Promise<boolean> {
  const bin = process.env.CODEX_BIN || "codex";
  try {
    await execFileAsync(bin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function tmuxNewSession(session: string, command: string): Promise<void> {
  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    session,
    "-x",
    "140",
    "-y",
    "45",
    command,
  ]);
}

async function tmuxKill(session: string): Promise<void> {
  try {
    await execFileAsync("tmux", ["kill-session", "-t", session]);
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codexCommand(cwd: string, prompt?: string): string {
  const bin = process.env.CODEX_BIN || "codex";
  const parts = [
    bin,
    "--dangerously-bypass-approvals-and-sandbox",
    // Include `-C <cwd>` so CONSENSUS_PROCESS_MATCH can target these processes deterministically.
    "-C",
    JSON.stringify(cwd),
  ];
  if (prompt) parts.push(JSON.stringify(prompt));
  return parts.join(" ");
}

test("live demo: 3 codex TUI sessions go idle -> active -> idle (30s capture)", async ({ page }, testInfo) => {
  test.setTimeout(240_000);

  if (process.env.RUN_LIVE_CODEX !== "1") {
    test.skip(true, "Set RUN_LIVE_CODEX=1 to run live Codex TUI demo.");
    return;
  }
  if (!(await isTmuxAvailable())) {
    test.skip(true, "tmux not available");
    return;
  }
  if (!(await isCodexAvailable())) {
    test.skip(true, "codex binary not available");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "consensus-tui-demo-"));

  const dirs = {
    a: path.join(root, "demo-a"),
    b: path.join(root, "demo-b"),
    c: path.join(root, "demo-c"),
  };
  await mkdir(dirs.a, { recursive: true });
  await mkdir(dirs.b, { recursive: true });
  await mkdir(dirs.c, { recursive: true });
  await writeFile(path.join(dirs.a, "README.md"), "demo-a\n", "utf8");
  await writeFile(path.join(dirs.b, "README.md"), "demo-b\n", "utf8");
  await writeFile(path.join(dirs.c, "README.md"), "demo-c\n", "utf8");

  const prefix = `consensus-tui-${testInfo.testId.slice(0, 8)}`;
  const sessions = {
    a: `${prefix}-a`,
    b: `${prefix}-b`,
    c: `${prefix}-c`,
  };

  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    const demoStartedAt = Date.now();

    // Filter the lane to only the demo Codex sessions, so OpenCode sessions in the
    // developer environment do not interfere with the "empty -> 3 agents" capture.
    await page.getByLabel("Search metadata").fill("consensus-tui-demo-");

    // Capture the "empty" state for a moment (requires CONSENSUS_PROCESS_MATCH to be set).
    await expect(page.locator("#active-list")).toBeVisible();
    await page.waitForFunction(() => {
      return document.querySelectorAll("#active-list .lane-item").length === 0;
    }, undefined, { timeout: 15_000 });
    await sleep(2000);

    const promptA = [
      "Run bash: sleep 2.",
      "Then run bash: ls.",
      'Then reply with exactly: "A done".',
    ].join(" ");
    const promptB = [
      "Run bash: sleep 3.",
      'Then run bash: echo "search 1 completed".',
      'Then reply with exactly: "B done".',
    ].join(" ");
    const promptC = [
      "Run bash: sleep 4.",
      "Then run bash: pwd.",
      'Then reply with exactly: "C done".',
    ].join(" ");

    // Start three interactive Codex TUI sessions with an initial prompt.
    // This avoids relying on UI keybindings for "submit" in the TUI.
    await tmuxNewSession(sessions.a, codexCommand(dirs.a, promptA));
    await tmuxNewSession(sessions.b, codexCommand(dirs.b, promptB));
    await tmuxNewSession(sessions.c, codexCommand(dirs.c, promptC));

    // Wait for agents to appear in the UI list (server side polling is 250ms).
    // Note: if OpenCode is enabled, this list may contain non-Codex sessions too.
    await page.waitForFunction(() => {
      return document.querySelectorAll("#active-list .lane-item").length >= 3;
    }, undefined, { timeout: 30_000 });

    // Ensure each session becomes active at least once.
    await page.evaluate(() => {
      (window as any).__consensusBusySeen = new Set<number>();
    });
    await page.waitForFunction(() => {
      const seen = (window as any).__consensusBusySeen as Set<number> | undefined;
      if (!seen) return false;
      const items = Array.from(document.querySelectorAll("#active-list .lane-item"));
      for (let i = 0; i < items.length; i += 1) {
        if (items[i]?.getAttribute("aria-busy") === "true") seen.add(i);
      }
      return seen.size >= 3;
    }, undefined, { timeout: 90_000, polling: 500 });

    // Ensure sessions return to idle within the capture window.
    await page.waitForFunction(() => {
      return (
        document.querySelectorAll('#active-list .lane-item[aria-busy="true"]')
          .length === 0
      );
    }, undefined, { timeout: 120_000 });

    // Keep the capture running long enough to visually confirm idle state.
    await sleep(10_000);

    const elapsed = Date.now() - demoStartedAt;
    if (elapsed < 30_000) {
      await sleep(30_000 - elapsed);
    }
  } finally {
    await tmuxKill(sessions.a);
    await tmuxKill(sessions.b);
    await tmuxKill(sessions.c);
    await rm(root, { recursive: true, force: true });
  }
});
