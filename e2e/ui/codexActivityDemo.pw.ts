import { test, expect } from "@playwright/test";
import { gotoMock, makeAgent, makeSnapshot, setMockSnapshot } from "./helpers";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("codex agents transition idle -> active -> idle (video demo)", async ({ page }) => {
  // This is a QA artifact: a long-running deterministic UI demo intended for video capture.
  // Run with: PW_VIDEO=1 npx playwright test e2e/ui/codexActivityDemo.pw.ts
  test.setTimeout(120_000);

  if (process.env.RUN_CODEX_UI_DEMO !== "1") {
    test.skip(true, "Set RUN_CODEX_UI_DEMO=1 to run the long-running UI demo.");
    return;
  }

  await gotoMock(page);

  const idle = "idle" as const;
  const active = "active" as const;

  const codexA = makeAgent({
    id: "codex-a",
    pid: 11001,
    title: "Codex A",
    cmd: "codex exec -C demo-a",
    cmdShort: "codex exec -C demo-a",
    kind: "exec",
    cpu: 0,
    mem: 90_000_000,
    state: idle,
    doing: "idle",
    summary: { current: "idle" },
  });
  const codexB = makeAgent({
    id: "codex-b",
    pid: 11002,
    title: "Codex B",
    cmd: "codex exec -C demo-b",
    cmdShort: "codex exec -C demo-b",
    kind: "exec",
    cpu: 0,
    mem: 90_000_000,
    state: idle,
    doing: "idle",
    summary: { current: "idle" },
  });
  const codexC = makeAgent({
    id: "codex-c",
    pid: 11003,
    title: "Codex C",
    cmd: "codex exec -C demo-c",
    cmdShort: "codex exec -C demo-c",
    kind: "exec",
    cpu: 0,
    mem: 90_000_000,
    state: idle,
    doing: "idle",
    summary: { current: "idle" },
  });

  // Start empty (shows "No agents detected."), then introduce three idle Codex agents.
  await setMockSnapshot(page, makeSnapshot([]));
  await sleep(1500);
  await setMockSnapshot(page, makeSnapshot([codexA, codexB, codexC]));

  await expect(page.locator("#active-list .lane-item")).toHaveCount(3);
  await sleep(2000);

  const start = Date.now();
  const demoMs = 30_000;
  while (Date.now() - start < demoMs) {
    const elapsed = Date.now() - start;

    // A: active 0s-12s
    const aActive = elapsed < 12_000;
    // B: active 6s-20s
    const bActive = elapsed >= 6_000 && elapsed < 20_000;
    // C: active 14s-28s
    const cActive = elapsed >= 14_000 && elapsed < 28_000;

    const step = Math.floor(elapsed / 2000);

    const aSummary = aActive
      ? [
          "tool: Context7 resolve-library-id (react)",
          "tool: Context7 query-docs #1 (useEffect cleanup)",
          "tool: Context7 query-docs #2 (useEffect vs useMemo)",
          "tool: Context7 query-docs #3 (Rules of Hooks)",
          "note: search 1 completed",
          "tool: web search #1 (Codex CLI notify hook docs)",
        ][step % 6]
      : "idle";

    const bSummary = bActive
      ? [
          "tool: web search #1 (Otel exporter config.toml)",
          "tool: web search #2 (agent-turn-complete payload fields)",
          "tool: Context7 query-docs #1 (cleanup examples)",
          "note: search 2 completed",
        ][step % 4]
      : "idle";

    const cSummary = cActive
      ? [
          "tool: grep (find hook config)",
          "tool: parse (session jsonl)",
          "tool: summarize (state transitions)",
          "tool: build (npm run build)",
        ][step % 4]
      : "idle";

    await setMockSnapshot(
      page,
      makeSnapshot([
        {
          ...codexA,
          cpu: aActive ? 6 : 0,
          state: aActive ? active : idle,
          doing: aActive ? "thinking" : "idle",
          summary: { current: aSummary },
        },
        {
          ...codexB,
          cpu: bActive ? 5 : 0,
          state: bActive ? active : idle,
          doing: bActive ? "thinking" : "idle",
          summary: { current: bSummary },
        },
        {
          ...codexC,
          cpu: cActive ? 7 : 0,
          state: cActive ? active : idle,
          doing: cActive ? "thinking" : "idle",
          summary: { current: cSummary },
        },
      ])
    );

    await sleep(1000);
  }

  // End all idle so the clip clearly shows the completion state.
  await setMockSnapshot(
    page,
    makeSnapshot([
      { ...codexA, cpu: 0, state: idle, doing: "idle", summary: { current: "idle" } },
      { ...codexB, cpu: 0, state: idle, doing: "idle", summary: { current: "idle" } },
      { ...codexC, cpu: 0, state: idle, doing: "idle", summary: { current: "idle" } },
    ])
  );
  await sleep(1500);
});
