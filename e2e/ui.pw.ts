import { test, expect } from "@playwright/test";
export {};

declare global {
  interface Window {
    __consensusMock: {
      setSnapshot: (snapshot: unknown) => void;
      setAgents: (agents: unknown[]) => void;
      getAgents: () => unknown[];
    };
    __consensusDebug?: Record<string, unknown>;
    __laneFlashRecords: Array<{ itemCount: number; emptyLabel: boolean }>;
    __laneFlashObserver: MutationObserver | null;
  }
}

test("keeps focus when other agents update", async ({ page }) => {
  await page.goto("/?mock=1");

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

test("renders recent events", async ({ page }) => {
  await page.goto("/?mock=1");

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

test("updates lane when opencode agent goes idle", async ({ page }) => {
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

  const idleLane = page.locator('#active-list .lane-item[data-id="901"]');
  await expect(idleLane).toHaveAttribute("data-state", "idle");
  await expect(idleLane).toHaveAttribute("data-active", "false");
  await expect(page.locator("#server-list")).toContainText("OpenCode server");
});

test("keeps servers out of active lane", async ({ page }) => {
  await page.goto("/?mock=1");

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
});

test("keeps idle agents visible after state transition", async ({ page }) => {
  await page.goto("/?mock=1");

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
  await expect(idleLane).toHaveAttribute("data-state", "idle");
  await expect(idleLane).toHaveAttribute("data-active", "false");
});

test("selects agent roof when overlapped by another tile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?mock=1");

  await page.evaluate(async () => {
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
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    window.__consensusMock.setLayout([
      { pid: 101, x: 0, y: 0 },
      { pid: 202, x: 2, y: 1 },
      { pid: 303, x: -4, y: 3 },
    ]);
  });

  const pick = await page.evaluate(async () => {
    const waitFrame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
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
    const roofHitW = tileW * 0.44;
    const roofHitH = roofHitW * 0.5;
    const pointInDiamond = (
      pt: { x: number; y: number },
      center: { x: number; y: number },
      width: number,
      height: number
    ) => {
      const dx = Math.abs(pt.x - center.x);
      const dy = Math.abs(pt.y - center.y);
      const halfDW = width / 2;
      const halfDH = height / 2;
      if (dx > halfDW || dy > halfDH) return false;
      return dx / halfDW + dy / halfDH <= 1;
    };
    const sign = (
      p1: { x: number; y: number },
      p2: { x: number; y: number },
      p3: { x: number; y: number }
    ) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    const pointInQuad = (
      pt: { x: number; y: number },
      quad: Array<{ x: number; y: number }>
    ) => {
      let hasPos = false;
      let hasNeg = false;
      for (let i = 0; i < quad.length; i += 1) {
        const next = (i + 1) % quad.length;
        const s = sign(pt, quad[i], quad[next]);
        if (s > 0) hasPos = true;
        if (s < 0) hasNeg = true;
        if (hasPos && hasNeg) return false;
      }
      return true;
    };
    const heightFor = (agent: { mem?: number; state?: string }) => {
      const memMB = (agent.mem || 0) / (1024 * 1024);
      const heightBase = Math.min(120, Math.max(18, memMB * 0.4));
      const idleScale = agent.state === "idle" ? 0.6 : 1;
      return heightBase * idleScale;
    };

    const pickAgent = hitList.find((item) => item.agent.pid === 101);
    if (!pickAgent) return null;
    const blocker = hitList.find((item) => item.agent.pid === 202);
    if (!blocker) return null;

    const blockerHeight = heightFor(blocker.agent);
    const topY = blocker.y - blockerHeight;
    const halfW = tileW / 2;
    const halfH = tileH / 2;
    const leftFace = [
      { x: blocker.x - halfW, y: topY },
      { x: blocker.x, y: topY + halfH },
      { x: blocker.x, y: blocker.y + halfH },
      { x: blocker.x - halfW, y: blocker.y },
    ];
    const rightFace = [
      { x: blocker.x + halfW, y: topY },
      { x: blocker.x, y: topY + halfH },
      { x: blocker.x, y: blocker.y + halfH },
      { x: blocker.x + halfW, y: blocker.y },
    ];
    const roofCenter = { x: pickAgent.x, y: pickAgent.roofY };
    const overlapsBody =
      pointInQuad(roofCenter, leftFace) || pointInQuad(roofCenter, rightFace);
    if (!overlapsBody) return null;

    const screenX = view.x + pickAgent.x * view.scale;
    const screenY = view.y + pickAgent.roofY * view.scale;
    if (screenX < 0 || screenY < 0 || screenX > window.innerWidth || screenY > window.innerHeight) {
      return null;
    }

    const pos = {
      x: (screenX - view.x) / view.scale,
      y: (screenY - view.y) / view.scale,
    };
    let hitPid: number | null = null;
    for (let i = hitList.length - 1; i >= 0; i -= 1) {
      const item = hitList[i];
      if (pointInDiamond(pos, { x: item.x, y: item.roofY }, roofHitW, roofHitH)) {
        hitPid = item.agent.pid;
        break;
      }
    }
    if (!hitPid) {
      for (let i = hitList.length - 1; i >= 0; i -= 1) {
        const item = hitList[i];
        if (pointInDiamond(pos, { x: item.x, y: item.y }, tileW, tileH)) {
          hitPid = item.agent.pid;
          break;
        }
      }
    }
    if (hitPid !== 101) return null;

    return {
      pid: 101,
      screenX,
      screenY,
    };
  });

  expect(pick).not.toBeNull();
  if (!pick) return;

  const canvas = page.locator("#scene");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("canvas bounding box not available");
  }
  const localX = pick.screenX - box.x;
  const localY = pick.screenY - box.y;
  await canvas.dispatchEvent("mousemove", {
    clientX: pick.screenX,
    clientY: pick.screenY,
  });
  await canvas.click({ position: { x: localX, y: localY }, force: true });

  await expect(page.locator("#panel")).toHaveClass(/open/);
  await expect(page.locator("#panel-content")).toContainText(String(pick.pid));
});

test("codex active state drives lane animation flag", async ({ page }) => {
  await page.goto("/?mock=1");

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
  await expect(idleLane).toHaveAttribute("data-state", "idle");
  await expect(idleLane).toHaveAttribute("data-active", "false");
  await expect(idleLane).toHaveAttribute("aria-busy", "false");
});

test("does not flash empty lane on rapid active/idle transitions", async ({ page }) => {
  await page.goto("/?mock=1");

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

  await page.evaluate(() => {
    const list = document.getElementById("active-list");
    if (!list) {
      throw new Error("Active list not found");
    }
    window.__laneFlashRecords = [];
    window.__laneFlashObserver = new MutationObserver(() => {
      const itemCount = list.querySelectorAll(".lane-item").length;
      const emptyLabel = list.textContent?.includes("No agents detected.") || false;
      window.__laneFlashRecords.push({ itemCount, emptyLabel });
    });
    window.__laneFlashObserver.observe(list, { childList: true, subtree: true });
  });

  await page.evaluate(({ active, idle }) => {
    const now = Date.now();
    window.__consensusMock.setSnapshot({ ts: now + 1, agents: [idle] });
    window.__consensusMock.setSnapshot({ ts: now + 2, agents: [active] });
  }, { active: activeAgent, idle: idleAgent });

  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const records = await page.evaluate(() => {
    window.__laneFlashObserver?.disconnect();
    return window.__laneFlashRecords || [];
  });

  expect(records.some((entry) => entry.itemCount === 0 || entry.emptyLabel)).toBeFalsy();
  await expect(page.locator("#active-list .lane-item")).toHaveCount(1);
});

test("does not duplicate lane items across successive snapshots", async ({ page }) => {
  await page.goto("/?mock=1");

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
  await page.goto("/?mock=1");

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
  const consensusPort = process.env.CONSENSUS_PORT || "8790";
  let activeSocket;
  const connected = new Promise((resolve) =>
    server.once("connection", (socket) => {
      activeSocket = socket;
      resolve(socket);
    })
  );

  const wsUrl = encodeURIComponent(`ws://127.0.0.1:${port}`);
  await page.goto(`http://127.0.0.1:${consensusPort}/?ws=${wsUrl}`);
  await connected;
  const debug = await page.evaluate(() => window.__consensusDebug || {});
  expect(debug.wsOverride).toContain("ws://");
  activeSocket.send(
    JSON.stringify({
      ts: Date.now(),
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
    })
  );
  await expect(page.locator("#active-list")).toContainText("OpenCode smoke");
  activeSocket.send(
    JSON.stringify({
      ts: Date.now(),
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
    })
  );
  const idleLane = page.locator('#active-list .lane-item[data-id="701"]');
  await expect(idleLane).toHaveAttribute("data-state", "idle");
  await expect(idleLane).toHaveAttribute("data-active", "false");

  await server.close();
});

test("shows distinct active entries for agents sharing repo label", async ({ page }) => {
  await page.goto("/?mock=1");

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
