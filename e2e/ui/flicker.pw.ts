import { test, expect } from "@playwright/test";
import {
  collectLaneMutations,
  gotoMock,
  hasLaneFlicker,
  makeAgent,
  makeSnapshot,
  pushSnapshots,
  setMockSnapshot,
  waitForActiveListCount,
} from "./helpers";

test.describe("no flicker", () => {
  test("does not flash empty lane during rapid idle/active updates", async ({ page }) => {
    await gotoMock(page);

    const activeAgent = makeAgent({
      id: "flicker-1",
      pid: 1201,
      cpu: 9,
      state: "active",
      doing: "thinking",
    });
    const idleAgent = { ...activeAgent, cpu: 0, state: "idle", doing: "idle" };

    await setMockSnapshot(page, makeSnapshot([activeAgent]));
    await waitForActiveListCount(page, 1);

    const records = await collectLaneMutations(page, async () => {
      await pushSnapshots(page, [
        makeSnapshot([idleAgent]),
        makeSnapshot([activeAgent]),
        makeSnapshot([activeAgent]),
      ]);
    });

    expect(hasLaneFlicker(records)).toBeFalsy();
    await expect(page.locator("#active-list .lane-item")).toHaveCount(1);
  });
});
