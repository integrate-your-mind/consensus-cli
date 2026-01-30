import { test, expect } from "@playwright/test";
import { gotoMock, makeAgent, makeSnapshot, setMockSnapshot } from "./ui/helpers";

test("lane stays active while working and marks idle quickly", async ({ page }) => {
  await gotoMock(page);

  const agent = makeAgent({
    id: "activity-1",
    pid: 1101,
    state: "active",
    doing: "cmd: npm run build",
  });

  await setMockSnapshot(page, makeSnapshot([agent]));
  await expect(page.locator("#active-list .lane-item")).toHaveCount(1);

  const idleAgent = { ...agent, state: "idle", cpu: 0, doing: "idle" };
  await setMockSnapshot(page, makeSnapshot([idleAgent]));

  const idleItem = page.locator("#active-list .lane-item");
  await expect(idleItem).toHaveCount(1);
  await expect(idleItem).toHaveAttribute("data-active", "false");
  await expect(idleItem).toHaveAttribute("data-state", "idle");
});
