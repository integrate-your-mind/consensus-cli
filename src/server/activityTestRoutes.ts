import express, { type Express } from "express";

type ReportFn = (laneId: string, source: string, active: boolean) => void;
type StateFn = (laneId: string) => unknown;

export function registerActivityTestRoutes(
  app: Express,
  deps: {
    report: ReportFn;
    state: StateFn;
    reset?: () => void;
    config?: () => unknown;
  }
): void {
  if (process.env.ACTIVITY_TEST_MODE !== "1") return;

  app.use("/__test", express.json());

  app.post("/__test/activity/report", (req, res) => {
    const { laneId, source, active } = req.body ?? {};
    if (
      typeof laneId !== "string" ||
      typeof source !== "string" ||
      typeof active !== "boolean"
    ) {
      return res
        .status(400)
        .json({
          error:
            "body must be { laneId: string, source: string, active: boolean }",
        });
    }
    deps.report(laneId, source, active);
    return res.json({ ok: true });
  });

  app.get("/__test/activity/state", (req, res) => {
    const laneId = String(req.query.laneId ?? "");
    if (!laneId) return res.status(400).json({ error: "missing laneId" });
    return res.json(deps.state(laneId));
  });

  app.post("/__test/activity/reset", (_req, res) => {
    deps.reset?.();
    return res.json({ ok: true });
  });

  app.get("/__test/activity/config", (_req, res) => {
    return res.json(deps.config?.() ?? { ok: true });
  });
}
