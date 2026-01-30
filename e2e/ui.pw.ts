import { test, expect } from "@playwright/test";
export {};

declare global {
  interface Window {
    __consensusMock: {
      setSnapshot: (snapshot: unknown) => void;
      setAgents: (agents: unknown[]) => void;
      getAgents: () => unknown[];
      getHitList: () => Array<{ x: number; y: number; roofY: number; agent: { pid?: number; mem?: number } }>;
      getView?: () => { x: number; y: number; scale: number };
    };
    __consensusDebug?: Record<string, unknown>;
    __laneFlashRecords: Array<{ itemCount: number; emptyLabel: boolean }>;
    __laneFlashObserver: MutationObserver | null;
  }
}

async function gotoMock(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?mock=1");
  await page.waitForFunction(() => (window as any).__consensusMock?.setSnapshot);
}

test("keeps focus when other agents update", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(async () => {
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

  await page.evaluate(async () => {
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

test("codex lane keeps idle sessions visible below active", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setAgents([
      {
        id: "101",
        pid: 101,
        cmd: "codex",
        cmdShort: "codex",
        kind: "tui",
        cpu: 0,
        mem: 50_000_000,
        state: "active",
        doing: "cmd: ls",
      },
    ]);
  });

  await expect(page.locator(".lane-item")).toContainText("codex#101");

  await page.evaluate(() => {
    window.__consensusMock.setAgents([
      {
        id: "101",
        pid: 101,
        cmd: "codex",
        cmdShort: "codex",
        kind: "tui",
        cpu: 0,
        mem: 50_000_000,
        state: "idle",
        doing: "cmd: ls",
      },
    ]);
  });

  const idleItem = page.locator('#active-list .lane-item[data-id="101"]');
  await expect(idleItem).toHaveCount(1);
  await expect(idleItem).toHaveAttribute("data-active", "false");
  await expect(idleItem).toHaveAttribute("data-state", "idle");
});

test("renders recent events", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(async () => {
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

test("renders claude agent lane item", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(async () => {
    window.__consensusMock.setAgents([
      {
        id: "123",
        pid: 123,
        identity: "claude:ses_123",
        cmd: "claude",
        cmdShort: "claude",
        kind: "claude-tui",
        cpu: 0,
        mem: 20_000_000,
        state: "active",
        title: "claude#123",
        doing: "prompt: hi",
      },
    ]);
  });

  const lane = page.getByTestId("lane-claude:ses_123");
  await expect(lane).toBeVisible();
  await expect(lane).toContainText("claude#123");
  await expect(lane).toContainText("prompt: hi");
});

test("updates lane when opencode agent goes idle", async ({ page }) => {
  await gotoMock(page);

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

  const idleLane = page.locator('#active-list .lane-item[data-id="901"]');
  await expect(idleLane).toHaveCount(1);
  await expect(idleLane).toHaveAttribute("data-active", "false");
  await expect(page.locator("#server-list")).toContainText("OpenCode server");
});

test("shows multiple opencode tui entries without dedupe", async ({ page }) => {
  await gotoMock(page);
  await page.waitForSelector("#scene");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "941",
          pid: 941,
          identity: "pid:941",
          sessionPath: "opencode:ses_shared",
          title: "OpenCode A",
          cmd: "opencode",
          cmdShort: "opencode",
          kind: "opencode-tui",
          cpu: 7,
          mem: 90_000_000,
          state: "active",
          doing: "thinking",
        },
        {
          id: "942",
          pid: 942,
          identity: "pid:942",
          sessionPath: "opencode:ses_shared",
          title: "OpenCode B",
          cmd: "opencode",
          cmdShort: "opencode",
          kind: "opencode-tui",
          cpu: 6,
          mem: 85_000_000,
          state: "active",
          doing: "thinking",
        },
      ],
    });
  });

  await expect(page.locator("#active-list .lane-item")).toHaveCount(2);
  await expect(page.locator("#active-list")).toContainText("OpenCode A");
  await expect(page.locator("#active-list")).toContainText("OpenCode B");

  const first = page.locator('#active-list .lane-item[data-id="pid:941"]');
  const second = page.locator('#active-list .lane-item[data-id="pid:942"]');
  await expect(first).toHaveAttribute("data-active", "true");
  await expect(second).toHaveAttribute("data-active", "true");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "942",
          pid: 942,
          identity: "pid:942",
          sessionPath: "opencode:ses_shared",
          title: "OpenCode B",
          cmd: "opencode",
          cmdShort: "opencode",
          kind: "opencode-tui",
          cpu: 0,
          mem: 85_000_000,
          state: "idle",
          doing: "idle",
        },
        {
          id: "941",
          pid: 941,
          identity: "pid:941",
          sessionPath: "opencode:ses_shared",
          title: "OpenCode A",
          cmd: "opencode",
          cmdShort: "opencode",
          kind: "opencode-tui",
          cpu: 5,
          mem: 90_000_000,
          state: "active",
          doing: "thinking",
        },
      ],
    });
  });

  await expect(page.locator("#active-list .lane-item")).toHaveCount(2);
  await expect(page.locator("#active-list")).toContainText("OpenCode A");
  await expect(page.locator("#active-list")).toContainText("OpenCode B");

  const orderAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#active-list .lane-item")).map((el) =>
      el.getAttribute("data-id")
    )
  );
  expect(orderAfter).toEqual(["pid:941", "pid:942"]);
  await expect(page.locator('#active-list .lane-item[data-id="pid:941"]')).toHaveAttribute(
    "data-active",
    "true"
  );
  await expect(page.locator('#active-list .lane-item[data-id="pid:942"]')).toHaveAttribute(
    "data-active",
    "false"
  );
});

test("keeps servers out of active lane", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "501",
          pid: 501,
          title: "OpenCode server",
          cmd: "opencode serve",
          cmdShort: "opencode serve",
          kind: "opencode-server",
          cpu: 4,
          mem: 80_000_000,
          state: "active",
          doing: "server",
        },
        {
          id: "502",
          pid: 502,
          title: "Codex",
          cmd: "codex",
          cmdShort: "codex",
          kind: "tui",
          cpu: 8,
          mem: 100_000_000,
          state: "active",
          doing: "cmd: ls",
        },
      ],
    });
  });

  await expect(page.locator("#active-list")).toContainText("Codex");
  await expect(page.locator("#active-list")).not.toContainText("OpenCode server");
  await expect(page.locator("#server-list")).toContainText("OpenCode server");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "501",
          pid: 501,
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
  const idleServer = page.locator('#server-list .lane-item[data-id="501"]');
  await expect(idleServer).toHaveCount(1);
  await expect(idleServer).toHaveAttribute("data-active", "false");
});

test("removes idle agents after state transition", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "801",
          pid: 801,
          title: "Build Bot",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 12,
          mem: 120_000_000,
          state: "active",
          doing: "cmd: npm run build",
        },
      ],
    });
  });

  await expect(page.locator("#active-list")).toContainText("Build Bot");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "801",
          pid: 801,
          title: "Build Bot",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 0,
          mem: 120_000_000,
          state: "idle",
          doing: "idle",
        },
      ],
    });
  });

  const idleLane = page.locator('#active-list .lane-item[data-id="801"]');
  await expect(idleLane).toHaveCount(1);
  await expect(idleLane).toHaveAttribute("data-active", "false");
});

test("keeps lane order stable when CPU changes", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "a",
          identity: "id:a",
          pid: 101,
          title: "Agent A",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 5,
          mem: 50_000_000,
          state: "active",
          doing: "task A",
        },
        {
          id: "b",
          identity: "id:b",
          pid: 202,
          title: "Agent B",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 20,
          mem: 60_000_000,
          state: "active",
          doing: "task B",
        },
      ],
    });
  });

  const orderBefore = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#active-list .lane-item")).map((el) =>
      el.getAttribute("data-id")
    )
  );

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "a",
          identity: "id:a",
          pid: 101,
          title: "Agent A",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 30,
          mem: 50_000_000,
          state: "active",
          doing: "task A",
        },
        {
          id: "b",
          identity: "id:b",
          pid: 202,
          title: "Agent B",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 1,
          mem: 60_000_000,
          state: "active",
          doing: "task B",
        },
      ],
    });
  });

  const orderAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#active-list .lane-item")).map((el) =>
      el.getAttribute("data-id")
    )
  );

  expect(orderAfter).toEqual(orderBefore);
});

test("avoids overlap in layout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoMock(page);

  await page.waitForFunction(
    () => typeof (window as any).__consensusMock?.getHitList === "function"
  );

  const result = await page.evaluate(async () => {
    const waitFrame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

    window.__consensusMock.setAgents([
      {
        id: "101",
        pid: 101,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 6,
        mem: 30_000_000,
        state: "active",
        repo: "overlap-suite",
        doing: "small",
      },
      {
        id: "202",
        pid: 202,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 48,
        mem: 1_000_000_000,
        state: "active",
        repo: "overlap-suite",
        doing: "large",
      },
    ]);
    await waitFrame();

    const hitListBefore = window.__consensusMock.getHitList();
    const positionsBefore: Record<string, { x: number; y: number }> = {};
    for (const item of hitListBefore) {
      const pid = item.agent.pid;
      if (pid !== undefined) {
        positionsBefore[String(pid)] = {
          x: Math.round(item.x),
          y: Math.round(item.y),
        };
      }
    }

    window.__consensusMock.setAgents([
      {
        id: "101",
        pid: 101,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 6,
        mem: 30_000_000,
        state: "active",
        repo: "overlap-suite",
        doing: "small",
      },
      {
        id: "202",
        pid: 202,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 48,
        mem: 1_000_000_000,
        state: "active",
        repo: "overlap-suite",
        doing: "large",
      },
      {
        id: "303",
        pid: 303,
        cmd: "codex exec",
        cmdShort: "codex exec",
        kind: "exec",
        cpu: 3,
        mem: 40_000_000,
        state: "active",
        repo: "overlap-suite",
        doing: "extra",
      },
    ]);
    await waitFrame();

    const hitList = window.__consensusMock.getHitList();
    const view =
      window.__consensusMock.getView?.() || {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        scale: 1,
      };
    const tileW = 96;
    const tileH = 48;
    const maxPulse = 7;
    const halfW = tileW / 2;
    const halfH = tileH / 2;

    const boundsFor = (item: { x: number; y: number; agent: { mem?: number } }) => {
      const memMB = (item.agent.mem || 0) / (1024 * 1024);
      const heightBase = Math.min(120, Math.max(18, memMB * 0.4));
      const height = heightBase + maxPulse;
      return {
        left: item.x - halfW,
        right: item.x + halfW,
        top: item.y - height - halfH,
        bottom: item.y + halfH,
      };
    };
    const overlaps = (a: ReturnType<typeof boundsFor>, b: ReturnType<typeof boundsFor>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    let overlapPair: Array<number | undefined> | null = null;
    for (let i = 0; i < hitList.length; i += 1) {
      const aBounds = boundsFor(hitList[i]);
      for (let j = i + 1; j < hitList.length; j += 1) {
        const bBounds = boundsFor(hitList[j]);
        if (overlaps(aBounds, bBounds)) {
          overlapPair = [hitList[i].agent.pid, hitList[j].agent.pid];
          break;
        }
      }
      if (overlapPair) break;
    }

    const positionsAfter: Record<string, { x: number; y: number }> = {};
    for (const item of hitList) {
      const pid = item.agent.pid;
      if (pid !== undefined) {
        positionsAfter[String(pid)] = {
          x: Math.round(item.x),
          y: Math.round(item.y),
        };
      }
    }

    return { hitCount: hitList.length, overlapPair, positionsBefore, positionsAfter };
  });

  expect(result.hitCount).toBeGreaterThan(0);
  expect(result.overlapPair).toBeNull();
  expect(result.positionsAfter["101"]).toEqual(result.positionsBefore["101"]);
  expect(result.positionsAfter["202"]).toEqual(result.positionsBefore["202"]);
});

test("codex active state drives lane animation flag", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "701",
          pid: 701,
          title: "Codex A",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 8,
          mem: 90_000_000,
          state: "active",
          doing: "cmd: npm run test",
        },
      ],
    });
  });

  const activeItem = page.locator('#active-list .lane-item[data-id="701"]');
  await expect(activeItem).toHaveAttribute("data-active", "true");
  await expect(activeItem).toHaveAttribute("aria-busy", "true");

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "701",
          pid: 701,
          title: "Codex A",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 0,
          mem: 90_000_000,
          state: "idle",
          doing: "idle",
        },
      ],
    });
  });

  const idleLane = page.locator('#active-list .lane-item[data-id="701"]');
  await expect(idleLane).toHaveCount(1);
  await expect(idleLane).toHaveAttribute("data-active", "false");
  await expect(idleLane).toHaveAttribute("aria-busy", "false");
});

test("keeps idle items visible when snapshot is idle", async ({ page }) => {
  await gotoMock(page);

  const activeAgent = {
    id: "880",
    pid: 880,
    title: "Rapid Bot",
    cmd: "opencode",
    cmdShort: "opencode",
    kind: "opencode-tui",
    cpu: 6,
    mem: 70_000_000,
    state: "active",
    doing: "thinking",
  };

  const idleAgent = {
    ...activeAgent,
    cpu: 0,
    state: "idle",
    doing: "idle",
  };

  await page.evaluate((agent) => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [agent],
    });
  }, activeAgent);

  await expect(page.locator("#active-list .lane-item")).toHaveCount(1);

  await page.evaluate((idle) => {
    window.__consensusMock.setSnapshot({ ts: Date.now() + 1, agents: [idle] });
  }, idleAgent);

  await expect(page.locator("#active-list .lane-item")).toHaveCount(1);
  await expect(page.locator('#active-list .lane-item[data-id="880"]')).toHaveAttribute(
    "data-active",
    "false"
  );

  await page.evaluate((active) => {
    window.__consensusMock.setSnapshot({ ts: Date.now() + 2, agents: [active] });
  }, activeAgent);

  await expect(page.locator("#active-list .lane-item")).toHaveCount(1);
});

test("does not duplicate lane items across successive snapshots", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "812",
          pid: 812,
          title: "Deploy Bot",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 8,
          mem: 90_000_000,
          state: "active",
          doing: "cmd: npm run deploy",
        },
      ],
    });
  });

  const items = page.locator("#active-list .lane-item");
  await expect(items).toHaveCount(1);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "812",
          pid: 812,
          title: "Deploy Bot",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 4,
          mem: 90_000_000,
          state: "active",
          doing: "cmd: npm run deploy --stage",
        },
      ],
    });
  });

  await expect(items).toHaveCount(1);
  await expect(page.locator("#active-list .lane-meta")).toContainText(
    "cmd: npm run deploy --stage"
  );
});

test("dedupes agents that share an identity across pids", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "910",
          pid: 910,
          identity: "codex:session-dupe",
          title: "Deploy Alpha",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 8,
          mem: 90_000_000,
          state: "active",
          doing: "cmd: npm run deploy",
        },
        {
          id: "911",
          pid: 911,
          identity: "codex:session-dupe",
          title: "Deploy Beta",
          cmd: "codex exec",
          cmdShort: "codex exec",
          kind: "tui",
          cpu: 4,
          mem: 90_000_000,
          state: "active",
          doing: "cmd: npm run deploy",
        },
      ],
    });
  });

  await expect(page.locator("#active-list .lane-item")).toHaveCount(1);
  await expect(page.locator("#active-list")).toContainText("Deploy Alpha");
  await expect(page.locator("#active-list")).not.toContainText("Deploy Beta");
});

test("streams snapshots over websocket override", async ({ page }) => {
  const { WebSocketServer } = await import("ws");
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  let activeSocket: import("ws").WebSocket | null = null;
  const connected = new Promise((resolve) =>
    server.once("connection", (socket) => {
      activeSocket = socket;
      resolve(socket);
    })
  );

  const wsUrl = encodeURIComponent(`ws://127.0.0.1:${port}`);
  await page.goto(`/?ws=${wsUrl}`);
  await connected;
  if (!activeSocket) {
    throw new Error("websocket override did not connect");
  }
  const socket = activeSocket as import("ws").WebSocket;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 250);
    activeSocket?.once("message", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const debug = await page.evaluate(() => window.__consensusDebug || {});
  expect(debug.wsOverride).toContain("ws://");
  socket.send(
    JSON.stringify({
      v: 1,
      t: "snapshot",
      seq: 1,
      data: {
        agents: [
          {
            id: "701",
            pid: 701,
            title: "OpenCode smoke",
            cmd: "opencode",
            cmdShort: "opencode",
            kind: "opencode-tui",
            cpu: 7,
            mem: 90_000_000,
            state: "active",
            doing: "thinking",
          },
        ],
      },
    })
  );
  await expect(page.locator("#active-list")).toContainText("OpenCode smoke");
  socket.send(
    JSON.stringify({
      v: 1,
      t: "snapshot",
      seq: 2,
      data: {
        agents: [
          {
            id: "701",
            pid: 701,
            title: "OpenCode smoke",
            cmd: "opencode",
            cmdShort: "opencode",
            kind: "opencode-tui",
            cpu: 0,
            mem: 90_000_000,
            state: "idle",
            doing: "idle",
          },
        ],
      },
    })
  );
  const idleLane = page.locator('#active-list .lane-item[data-id="701"]');
  await expect(idleLane).toHaveCount(1);
  await expect(idleLane).toHaveAttribute("data-active", "false");

  await server.close();
});

test("shows distinct active entries for agents sharing repo label", async ({ page }) => {
  await gotoMock(page);

  await page.evaluate(() => {
    window.__consensusMock.setSnapshot({
      ts: Date.now(),
      agents: [
        {
          id: "111",
          pid: 111,
          title: "Repo A",
          repo: "repo-a",
          cmd: "codex",
          cmdShort: "codex",
          kind: "tui",
          cpu: 5,
          mem: 80_000_000,
          state: "active",
          doing: "cmd: ls",
        },
        {
          id: "222",
          pid: 222,
          title: "Repo A",
          repo: "repo-a",
          cmd: "codex",
          cmdShort: "codex",
          kind: "tui",
          cpu: 4,
          mem: 75_000_000,
          state: "active",
          doing: "cmd: pwd",
        },
      ],
    });
  });

  const labels = page.locator("#active-list .lane-label", { hasText: "Repo A" });
  await expect(labels).toHaveCount(2);
});
