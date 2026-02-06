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

async function tmuxSend(session: string, text: string): Promise<void> {
  // `send-keys` with Enter at end to submit the prompt.
  await execFileAsync("tmux", ["send-keys", "-t", session, text, "Enter"]);
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

function codexCommand(cwd: string): string {
  const bin = process.env.CODEX_BIN || "codex";
  // Include `-C <cwd>` so CONSENSUS_PROCESS_MATCH can target these processes deterministically.
  return `${bin} --dangerously-bypass-approvals-and-sandbox -C ${JSON.stringify(
    cwd
  )}`;
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

    // Capture the "empty" state for a moment.
    await expect(page.locator("#active-list")).toBeVisible();
    await sleep(1500);

    // Start three interactive Codex TUI sessions.
    await tmuxNewSession(sessions.a, codexCommand(dirs.a));
    await tmuxNewSession(sessions.b, codexCommand(dirs.b));
    await tmuxNewSession(sessions.c, codexCommand(dirs.c));

    // Wait for agents to appear in the UI list (server side polling is 250ms).
    // Note: if OpenCode is enabled, this list may contain non-Codex sessions too.
    await page.waitForFunction(() => {
      return document.querySelectorAll("#active-list .lane-item").length >= 3;
    }, undefined, { timeout: 30_000 });

    // Give the TUIs a moment to settle before firing prompts.
    await sleep(2000);

    // Trigger staggered tool-heavy work. `sleep` keeps a tool open long enough to visualize.
    await tmuxSend(
      sessions.a,
      [
        "Run bash: sleep 2.",
        "Then run bash: ls.",
        'Then reply with exactly: "A done".',
      ].join(" ")
    );
    await sleep(600);
    await tmuxSend(
      sessions.b,
      [
        "Run bash: sleep 3.",
        'Then run bash: echo "search 1 completed".',
        'Then reply with exactly: "B done".',
      ].join(" ")
    );
    await sleep(600);
    await tmuxSend(
      sessions.c,
      [
        "Run bash: sleep 4.",
        "Then run bash: pwd.",
        'Then reply with exactly: "C done".',
      ].join(" ")
    );

    // Let the scan loop observe activity and then settle back to idle.
    await sleep(30_000);
  } finally {
    await tmuxKill(sessions.a);
    await tmuxKill(sessions.b);
    await tmuxKill(sessions.c);
    await rm(root, { recursive: true, force: true });
  }
});
