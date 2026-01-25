import { test, expect } from "@playwright/test";

test("keeps focus when other agents update", async ({ page }) => {
  await page.goto("/?mock=1");

  await page.evaluate(() => {
    window.__consensusMock.setAgents([
      {
        id: "101",
        pid: 101,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 6,
        mem: 50_000_000,
        state: "active",
        doing: "cmd: ls",
      },
      {
        id: "202",
        pid: 202,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 12,
        mem: 120_000_000,
        state: "active",
        doing: "cmd: npm run dev",
      },
    ]);
  });

  await page.getByText("codex#101", { exact: false }).click();
  await expect(page.locator("#panel")).toHaveClass(/open/);
  await expect(page.locator("#panel-content")).toContainText("pid");
  await expect(page.locator("#panel-content")).toContainText("101");

  await page.evaluate(() => {
    window.__consensusMock.setAgents([
      {
        id: "101",
        pid: 101,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 6,
        mem: 50_000_000,
        state: "active",
        doing: "cmd: ls",
      },
      {
        id: "202",
        pid: 202,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 15,
        mem: 120_000_000,
        state: "active",
        doing: "cmd: npm run dev",
      },
      {
        id: "303",
        pid: 303,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 20,
        mem: 130_000_000,
        state: "active",
        doing: "cmd: npm run build",
      },
    ]);
  });

  await expect(page.locator("#panel-content")).toContainText("pid");
  await expect(page.locator("#panel-content")).toContainText("101");
});

test("renders recent events", async ({ page }) => {
  await page.goto("/?mock=1");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "404",
          pid: 404,
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "exec",
          cpu: 9,
          mem: 80_000_000,
          state: "active",
          doing: "cmd: ls",
          events: [
            {
              ts: Date.now(),
              type: "command_execution",
              summary: "cmd: ls",
            },
          ],
        },
      ],
    });
  });

  await page.getByText("codex#404", { exact: false }).click();
  await expect(page.locator("#panel-content")).toContainText("Recent Events");
  await expect(page.locator("#panel-content")).toContainText("cmd: ls");
});

test("updates active lane when opencode agent goes idle", async ({ page }) => {
  await page.goto("/?mock=1");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "901",
          pid: 901,
          title: "OpenCode smoke",
          cmd: "opencode",
          cmdShort: "opencode",
          kind: "opencode-tui",
          cpu: 5,
          mem: 90_000_000,
          state: "active",
          doing: "thinking",
        },
        {
          id: "902",
          pid: 902,
          title: "OpenCode server",
          cmd: "opencode serve",
          cmdShort: "opencode serve",
          kind: "opencode-server",
          cpu: 0,
          mem: 80_000_000,
          state: "idle",
          doing: "server",
        },
      ],
    });
  });

  await expect(page.locator("#active-list")).toContainText("OpenCode smoke");
  await expect(page.locator("#server-list")).toContainText("OpenCode server");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "901",
          pid: 901,
          title: "OpenCode smoke",
          cmd: "opencode",
          cmdShort: "opencode",
          kind: "opencode-tui",
          cpu: 0,
          mem: 90_000_000,
          state: "idle",
          doing: "idle",
        },
        {
          id: "902",
          pid: 902,
          title: "OpenCode server",
          cmd: "opencode serve",
          cmdShort: "opencode serve",
          kind: "opencode-server",
          cpu: 0,
          mem: 80_000_000,
          state: "idle",
          doing: "server",
        },
      ],
    });
  });

  await expect(page.locator("#active-list")).not.toContainText("OpenCode smoke");
  await expect(page.locator("#server-list")).toContainText("OpenCode server");
});
