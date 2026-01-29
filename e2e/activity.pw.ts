import { test, expect } from "@playwright/test";

test("lane stays active while working and turns off quickly", async ({ page }) => {
  const laneId = process.env.LANE_ID ?? "test-session";
  const source = process.env.ACTIVITY_SOURCE ?? "test";
  const laneTestId = `lane-${laneId}`;

  await page.goto("/");

  const search = page.locator("#search");
  if (await search.count()) {
    await search.fill(laneId);
  }

  const lane = page.locator(`[data-testid="${laneTestId}"]`);

  await page.evaluate(async () => {
    await fetch("/__test/activity/reset", { method: "POST" }).catch(() => {});
  });

  const result = await page.evaluate(
    async ({ laneId, source, laneTestId }) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const report = async (active: boolean) => {
        const res = await fetch("/__test/activity/report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ laneId, source, active }),
        });
        if (!res.ok) throw new Error(`report failed: ${res.status}`);
      };

      const getState = () => {
        const el = document.querySelector(`[data-testid="${laneTestId}"]`);
        return el ? el.getAttribute("data-state") ?? "" : "";
      };

      const waitForState = async (value: string, timeoutMs: number) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (getState() === value) return;
          await sleep(20);
        }
        throw new Error(`state not reached: ${value}`);
      };

      const states: string[] = [];
      const recordState = () => {
        const current = getState();
        if (!current) return;
        if (states.length === 0 || states[states.length - 1] !== current) {
          states.push(current);
        }
      };

      const tAct0 = performance.now();
      await report(true);
      await waitForState("active", 3000);
      const activationMs = performance.now() - tAct0;
      recordState();

      const start = performance.now();
      const pulseEveryMs = 300;
      const durationMs = 3000;
      let wentIdleDuringWork = false;
      while (performance.now() - start < durationMs) {
        await report(true);
        await sleep(pulseEveryMs);
        const state = getState();
        if (state) {
          recordState();
          if (state === "idle") {
            wentIdleDuringWork = true;
            break;
          }
        }
      }

      const tOff0 = performance.now();
      await report(false);
      await waitForState("idle", 3000);
      const offMs = performance.now() - tOff0;
      recordState();

      const flips = Math.max(0, states.length - 1);

      return { activationMs, offMs, wentIdleDuringWork, flips, states };
    },
    { laneId, source, laneTestId }
  );

  await expect(lane).toHaveCount(1, { timeout: 3000 });
  expect(result.activationMs).toBeLessThan(3000);
  expect(result.wentIdleDuringWork).toBe(false);
  expect(result.offMs).toBeLessThan(3000);

  test.info().annotations.push({
    type: "offMs",
    description: String(Math.round(result.offMs)),
  });
});
