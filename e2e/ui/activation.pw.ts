import { test, expect } from "@playwright/test";
import {
  gotoMock,
  makeAgent,
  makeSnapshot,
  measureActivationLatency,
  setMockSnapshot,
  waitForActiveListCount,
} from "./helpers";

test.describe("activation latency", () => {
  test("shows active agent within latency budget", async ({ page }) => {
    await gotoMock(page);
    await setMockSnapshot(page, makeSnapshot([]));
    await waitForActiveListCount(page, 0);

    const agent = makeAgent({
      id: "latency-1",
      pid: 1101,
      cpu: 12,
      state: "active",
      doing: "cmd: npm run build",
    });

    const result = await measureActivationLatency(page, makeSnapshot([agent]), {
      maxFrames: 3,
      timeoutMs: 250,
    });

    expect(result.frames).toBeLessThanOrEqual(3);
    expect(result.ms).toBeLessThan(250);
    await expect(page.locator("#active-list .lane-item")).toHaveCount(1);
  });
});
