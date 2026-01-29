import type { Page } from "@playwright/test";

type AgentState = "active" | "idle" | "error";

type Agent = {
  id: string;
  pid: number;
  title?: string;
  repo?: string;
  cmd: string;
  cmdShort: string;
  kind: string;
  cpu: number;
  mem: number;
  state: AgentState;
  doing?: string;
  events?: Array<{ ts: number; type: string; summary: string }>;
  summary?: { current?: string };
};

type Snapshot = {
  ts: number;
  agents: Agent[];
  meta?: Record<string, unknown>;
};

type LaneMutation = {
  itemCount: number;
  emptyLabel: boolean;
  ts: number;
};

type ActivationResult = {
  frames: number;
  ms: number;
};

type ActivationOptions = {
  maxFrames?: number;
  timeoutMs?: number;
};

type MutationOptions = {
  settleFrames?: number;
};

const defaultAgent: Agent = {
  id: "100",
  pid: 100,
  title: "Activation Bot",
  cmd: "codex exec",
  cmdShort: "codex exec",
  kind: "tui",
  cpu: 8,
  mem: 90_000_000,
  state: "active",
  doing: "cmd: npm run build",
};

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return { ...defaultAgent, ...overrides };
}

export function makeSnapshot(agents: Agent[], overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    ts: Date.now(),
    agents,
    ...overrides,
  };
}

export async function gotoMock(page: Page): Promise<void> {
  await page.goto("/?mock=1");
  await page.waitForFunction(() => !!(window as any).__consensusMock);
}

export async function setMockSnapshot(page: Page, snapshot: Snapshot): Promise<void> {
  await page.evaluate((snap) => {
    const win = window as any;
    win.__consensusMock?.setSnapshot(snap);
  }, snapshot);
}

export async function pushSnapshots(page: Page, snapshots: Snapshot[]): Promise<void> {
  await page.evaluate((snaps) => {
    const win = window as any;
    for (const snap of snaps) {
      win.__consensusMock?.setSnapshot(snap);
    }
  }, snapshots);
}

export async function waitForActiveListCount(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll("#active-list .lane-item").length === expected,
    count
  );
}

export async function waitForFrames(page: Page, frames = 2): Promise<void> {
  await page.evaluate((frameCount) => {
    return new Promise<void>((resolve) => {
      let remaining = frameCount;
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, frames);
}

export async function measureActivationLatency(
  page: Page,
  snapshot: Snapshot,
  options: ActivationOptions = {}
): Promise<ActivationResult> {
  const { maxFrames = 6, timeoutMs = 400 } = options;
  return page.evaluate(
    async ({ snap, maxFrames: max, timeout }) => {
      const list = document.getElementById("active-list");
      if (!list) {
        throw new Error("Active list not found");
      }
      const win = window as any;
      const start = performance.now();
      return await new Promise<ActivationResult>((resolve, reject) => {
        let frames = 0;
        const timeoutId = window.setTimeout(() => {
          reject(new Error(`Activation timeout after ${timeout}ms`));
        }, timeout);

        const check = () => {
          frames += 1;
          if (list.querySelector(".lane-item")) {
            clearTimeout(timeoutId);
            resolve({ frames, ms: performance.now() - start });
            return;
          }
          if (frames >= max) {
            clearTimeout(timeoutId);
            reject(new Error(`Activation exceeded ${max} frames`));
            return;
          }
          requestAnimationFrame(check);
        };

        win.__consensusMock?.setSnapshot(snap);
        requestAnimationFrame(check);
      });
    },
    { snap: snapshot, maxFrames, timeout: timeoutMs }
  );
}

export async function collectLaneMutations(
  page: Page,
  action: () => Promise<void>,
  options: MutationOptions = {}
): Promise<LaneMutation[]> {
  const { settleFrames = 2 } = options;
  await page.evaluate(() => {
    const list = document.getElementById("active-list");
    if (!list) {
      throw new Error("Active list not found");
    }
    const win = window as any;
    win.__laneMutationRecords = [];
    win.__laneMutationObserver = new MutationObserver(() => {
      const itemCount = list.querySelectorAll(".lane-item").length;
      const emptyLabel = list.textContent?.includes("No agents detected.") || false;
      win.__laneMutationRecords.push({
        itemCount,
        emptyLabel,
        ts: performance.now(),
      });
    });
    win.__laneMutationObserver.observe(list, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  await action();
  await waitForFrames(page, settleFrames);

  return page.evaluate(() => {
    const win = window as any;
    if (win.__laneMutationObserver) {
      win.__laneMutationObserver.disconnect();
    }
    return win.__laneMutationRecords || [];
  });
}

export function hasLaneFlicker(records: LaneMutation[]): boolean {
  return records.some((entry) => entry.itemCount === 0 || entry.emptyLabel);
}
