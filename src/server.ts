import express from "express";
import { spawn } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "url";
import { Effect, Exit, Fiber } from "effect";
import { scanCodexProcesses, markSessionDirty } from "./scan.js";
import { resolveCodexHome } from "./codexLogs.js";
import { onOpenCodeEvent, stopOpenCodeEventStream } from "./opencodeEvents.js";
import { CodexEventSchema } from "./codex/types.js";
import { ClaudeEventSchema } from "./claude/types.js";
import { handleClaudeEventEffect } from "./services/claudeEvents.js";
import { Schema, ParseResult } from "effect";
import type { SnapshotPayload, AgentSnapshot, SnapshotMeta } from "./types.js";
import { registerActivityTestRoutes } from "./server/activityTestRoutes.js";
import { normalizeCodexNotifyInstall } from "./codexNotifyInstall.js";
import {
  annotateSpan,
  disposeObservability,
  recordActiveSessions,
  recordError,
  recordHttpMetrics,
  recordJobComplete,
  recordJobStart,
  recordScanDuration,
  recordScanInFlight,
  recordScanStall,
  runFork,
  runPromise,
  withSpan,
} from "./observability/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDevRuntime = path.extname(__filename) === ".ts";
const liveReloadEnabled =
  process.env.CONSENSUS_LIVE_RELOAD === "1" ||
  (isDevRuntime && process.env.CONSENSUS_LIVE_RELOAD !== "0");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

type WsMode = "legacy" | "json";
type DeltaOp =
  | { op: "upsert"; id: string; value: AgentSnapshot }
  | { op: "remove"; id: string }
  | { op: "meta"; value: SnapshotMeta | null }
  | { op: "ts"; value: number };
type WsClientState = { mode: WsMode; ready: boolean };
const wsClients = new Map<WebSocket, WsClientState>();
let wsProtocolSeq = 0;

function nextProtocolSeq(): number {
  wsProtocolSeq += 1;
  return wsProtocolSeq;
}

function serializeAgent(agent: AgentSnapshot): string {
  return JSON.stringify(agent);
}

function buildDelta(prev: SnapshotPayload, next: SnapshotPayload): DeltaOp[] {
  const ops: DeltaOp[] = [];
  if (prev.ts !== next.ts) {
    ops.push({ op: "ts", value: next.ts });
  }
  const prevMeta = prev.meta ?? null;
  const nextMeta = next.meta ?? null;
  if (JSON.stringify(prevMeta) !== JSON.stringify(nextMeta)) {
    ops.push({ op: "meta", value: nextMeta });
  }
  const prevById = new Map<string, AgentSnapshot>();
  for (const agent of prev.agents) {
    prevById.set(identityForAgent(agent), agent);
  }
  const nextById = new Map<string, AgentSnapshot>();
  for (const agent of next.agents) {
    nextById.set(identityForAgent(agent), agent);
  }
  for (const [id, agent] of nextById) {
    const prevAgent = prevById.get(id);
    if (!prevAgent || serializeAgent(prevAgent) !== serializeAgent(agent)) {
      ops.push({ op: "upsert", id, value: agent });
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) {
      ops.push({ op: "remove", id });
    }
  }
  return ops;
}

function sendEnvelope(socket: WebSocket, message: object): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function sendWelcome(socket: WebSocket): void {
  sendEnvelope(socket, {
    v: 1,
    t: "welcome",
    enc: "json",
    serverTime: Date.now(),
  });
}

function sendSnapshotEnvelope(socket: WebSocket, snapshot: SnapshotPayload): void {
  sendEnvelope(socket, {
    v: 1,
    t: "snapshot",
    seq: nextProtocolSeq(),
    data: snapshot,
  });
}

function sendDeltaEnvelope(socket: WebSocket, ops: DeltaOp[]): void {
  if (!ops.length) return;
  sendEnvelope(socket, {
    v: 1,
    t: "delta",
    seq: nextProtocolSeq(),
    ops,
  });
}

const port = Number(process.env.CONSENSUS_PORT || 8787);
const host = process.env.CONSENSUS_HOST || "127.0.0.1";
const pollMs = Math.max(50, Number(process.env.CONSENSUS_POLL_MS || 250));
const scanTimeoutMs = Math.max(
  500,
  Number(process.env.CONSENSUS_SCAN_TIMEOUT_MS || 5000)
);
const scanStallMs = Math.max(
  250,
  Number(process.env.CONSENSUS_SCAN_STALL_MS || Math.floor(scanTimeoutMs * 0.6))
);
const scanStallCheckMs = Math.max(
  250,
  Number(
    process.env.CONSENSUS_SCAN_STALL_CHECK_MS || Math.min(1000, scanStallMs)
  )
);
const isDebugActivity = () => process.env.CONSENSUS_DEBUG_ACTIVITY === "1";
const codexHome = resolveCodexHome();
const codexSessionsDir = path.join(codexHome, "sessions");
const codexWatchPoll = process.env.CONSENSUS_CODEX_WATCH_POLL !== "0";
const codexWatchInterval = Math.max(
  100,
  Number(process.env.CONSENSUS_CODEX_WATCH_INTERVAL_MS || 1000)
);
const codexWatchBinaryInterval = Math.max(
  100,
  Number(
    process.env.CONSENSUS_CODEX_WATCH_BINARY_INTERVAL_MS || codexWatchInterval
  )
);
const codexNotifyInstall = normalizeCodexNotifyInstall(
  process.env.CONSENSUS_CODEX_NOTIFY_INSTALL
);
const codexNotifyInstallTimeout = Math.max(
  2000,
  Number(process.env.CONSENSUS_CODEX_NOTIFY_INSTALL_TIMEOUT_MS || 5000)
);
let holdTickTimeout: ReturnType<typeof setTimeout> | null = null;
let holdTickAt = 0;

const publicDir = path.join(__dirname, "..", "public");
const clientBuildDir = path.join(publicDir, "dist");
const activityTestMode = process.env.ACTIVITY_TEST_MODE === "1";
const testUiPath = fs.existsSync(path.join(clientBuildDir, "index.html"))
  ? path.join(clientBuildDir, "index.html")
  : path.join(publicDir, "index.html");
if (activityTestMode) {
  app.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(testUiPath);
  });
}
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-cache");
  }
  next();
});
// Serve built client files if they exist, otherwise fall back to public for dev.
if (fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
}
app.use(express.static(publicDir));

const reloadClients = new Set<express.Response>();
let reloadWatcher: FSWatcher | null = null;
let reloadTimer: NodeJS.Timeout | null = null;
let reloadReason = "change";

function broadcastReload(reason: string): void {
  if (!reloadClients.size) return;
  const payload = JSON.stringify({ ts: Date.now(), reason });
  const message = `event: reload\ndata: ${payload}\n\n`;
  for (const res of reloadClients) {
    try {
      res.write(message);
    } catch {
      reloadClients.delete(res);
    }
  }
}

function scheduleReload(reason: string): void {
  if (!liveReloadEnabled) return;
  reloadReason = reason;
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    broadcastReload(reloadReason);
  }, 80);
}

function startReloadWatcher(): void {
  if (!liveReloadEnabled || reloadWatcher) return;
  reloadWatcher = chokidar.watch(publicDir, {
    ignoreInitial: true,
    ignored: /(^|[\/\\])\../,
  });
  reloadWatcher.on("error", (err) => {
    process.stderr.write(`[consensus] reload watcher error: ${String(err)}\n`);
  });
  reloadWatcher.on("all", (event, filePath) => {
    const relative = path.relative(publicDir, filePath);
    scheduleReload(`${event}:${relative || "public"}`);
  });
}

function stopReloadWatcher(): Promise<void> | void {
  if (!reloadWatcher) return;
  const closing = reloadWatcher.close();
  reloadWatcher = null;
  return closing;
}

if (liveReloadEnabled) {
  app.get("/__dev/reload", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write("event: ready\ndata: ok\n\n");
    reloadClients.add(res);
    req.on("close", () => {
      reloadClients.delete(res);
    });
  });
}

function runHttpEffect(
  req: express.Request,
  res: express.Response,
  route: string,
  effect: Effect.Effect<number, never, never>
): void {
  const startedAt = Date.now();
  const method = req.method;
  const instrumented = effect.pipe(
    withSpan("http.request", {
      attributes: {
        "http.method": method,
        "http.route": route,
      },
    }),
    Effect.tap((status) =>
      Effect.all([
        annotateSpan("http.status_code", status),
        recordHttpMetrics({
          method,
          route,
          status: String(status),
          durationMs: Date.now() - startedAt,
        }),
      ]).pipe(Effect.asVoid)
    )
  );
  void runPromise(instrumented).catch((err) => {
    logRuntimeError("http handler failed", err);
  });
}

app.get("/api/snapshot", (req, res) => {
  const mode =
    typeof req.query.mode === "string"
      ? req.query.mode
      : Array.isArray(req.query.mode)
        ? req.query.mode[0]
        : undefined;
  const wantsFull =
    mode === "full" || req.query.full === "1" || req.query.full === "true";
  const wantsRefresh =
    req.query.refresh === "1" || req.query.refresh === "true";

  if (wantsRefresh) {
    requestTick(wantsFull ? "full" : "fast");
  }

  if (!wantsFull) {
    res.setHeader("X-Consensus-Snapshot", "cached");
    res.json(lastSnapshot);
    return;
  }

  const effect = Effect.tryPromise({
    try: (signal) => scanCodexProcesses({ mode: "full", signal }),
    catch: (err) => err as Error,
  })
    .pipe(Effect.timeout(`${scanTimeoutMs} millis`))
    .pipe(
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          lastBaseSnapshot = snapshot;
          lastSnapshot = applyTestOverrides(snapshot);
          res.setHeader("X-Consensus-Snapshot", "full");
          res.json(lastSnapshot);
        })
      ),
      Effect.as(200),
      Effect.tapError(() => recordError("http_snapshot")),
      Effect.catchAll(() =>
        Effect.sync(() => {
          res.setHeader("X-Consensus-Snapshot", "cached-fallback");
          res.json(lastSnapshot);
        }).pipe(Effect.as(200))
      )
    );

  runHttpEffect(req, res, "/api/snapshot", effect);
});

app.get("/health", (req, res) => {
  runHttpEffect(
    req,
    res,
    "/health",
    Effect.sync(() => {
      res.json({ ok: true });
      return 200;
    })
  );
});

app.post("/__debug/activity", express.json(), (req, res) => {
  const effect = Effect.sync(() => {
    const enable =
      req.query.enable ??
      req.query.enabled ??
      req.body?.enable ??
      req.body?.enabled;
    const normalized =
      enable === "1" ||
      enable === "true" ||
      enable === "on" ||
      enable === 1 ||
      enable === true;
    process.env.CONSENSUS_DEBUG_ACTIVITY = normalized ? "1" : "0";
    res.json({ ok: true, enabled: process.env.CONSENSUS_DEBUG_ACTIVITY === "1" });
    return 200;
  });

  runHttpEffect(req, res, "/__debug/activity", effect);
});

// Codex webhook endpoint - receives events from notify hook
app.post("/api/codex-event", express.json(), (req, res) => {
  const effect = Effect.gen(function* () {
    // Decode and validate event
    const decodeResult = Schema.decodeUnknownEither(CodexEventSchema)(req.body);

    if (decodeResult._tag === "Left") {
      const error = ParseResult.TreeFormatter.formatErrorSync(decodeResult.left);
      res.status(400).json({
        ok: false,
        error: "Invalid event schema",
        details: error
      });
      return 400;
    }

    const event = decodeResult.right;

    if (process.env.CONSENSUS_CODEX_NOTIFY_DEBUG === "1") {
      process.stderr.write(
        `[consensus] codex event type=${event.type} thread=${event.threadId}\n`
      );
    }

    // Trigger fast scan to update UI
    requestTick("fast");

    res.json({ ok: true, received: event.type });
    return 200;
  });

  runHttpEffect(req, res, "/api/codex-event", effect);
});

app.get("/api/codex-event", (_req, res) => {
  res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    message: "This endpoint expects a POST request with an event payload.",
  });
});

// Claude webhook endpoint - receives events from Claude hooks
app.post("/api/claude-event", express.json(), (req, res) => {
  const effect = Effect.gen(function* () {
    const decodeResult = Schema.decodeUnknownEither(ClaudeEventSchema)(req.body);

    if (decodeResult._tag === "Left") {
      const error = ParseResult.TreeFormatter.formatErrorSync(decodeResult.left);
      res.status(400).json({
        ok: false,
        error: "Invalid event schema",
        details: error,
      });
      return 400;
    }

    const event = decodeResult.right;
    yield* handleClaudeEventEffect(event);
    requestTick("fast");

    res.json({ ok: true, received: event.type });
    return 200;
  });

  runHttpEffect(req, res, "/api/claude-event", effect);
});

app.get("/api/claude-event", (_req, res) => {
  res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    message: "This endpoint expects a POST request with an event payload.",
  });
});

let lastSnapshot: SnapshotPayload = { ts: Date.now(), agents: [] };
let lastBaseSnapshot: SnapshotPayload = lastSnapshot;
let scanning = false;
let scanStartAt: number | null = null;
let scanMode: "fast" | "full" | null = null;
let scanLastStallAt = 0;
let pendingMode: "fast" | "full" | null = null;
let codexWatcher: FSWatcher | null = null;
let unsubscribeOpenCode: (() => void) | null = null;
const testActivity = new Map<
  string,
  { laneId: string; source: string; active: boolean; updatedAt: number }
>();

function identityForAgent(agent: AgentSnapshot): string {
  return agent.identity || agent.id;
}

function logDebug(message: string): void {
  if (!isDebugActivity()) return;
  process.stderr.write(`[consensus][activity] ${message}\n`);
}

function logRuntimeError(scope: string, err: unknown): void {
  process.stderr.write(`[consensus][runtime] ${scope} ${String(err)}\n`);
}

function annotateActivityMeta(
  activity: SnapshotMeta["activity"] | undefined
): Effect.Effect<void> {
  if (!activity) return Effect.void;
  const effects: Effect.Effect<void>[] = [];
  const counts = activity.counts ?? {};
  for (const [provider, states] of Object.entries(counts)) {
    effects.push(annotateSpan(`activity.${provider}.active`, states.active ?? 0));
    effects.push(annotateSpan(`activity.${provider}.idle`, states.idle ?? 0));
    effects.push(annotateSpan(`activity.${provider}.error`, states.error ?? 0));
  }
  const transitions = activity.transitions ?? {};
  for (const [provider, summary] of Object.entries(transitions)) {
    effects.push(
      annotateSpan(`activity.${provider}.transition_total`, summary.total ?? 0)
    );
    if (isDebugActivity()) {
      effects.push(
        annotateSpan(
          `activity.${provider}.transition_reasons`,
          JSON.stringify(summary.byReason ?? {})
        )
      );
      effects.push(
        annotateSpan(
          `activity.${provider}.transition_states`,
          JSON.stringify(summary.byState ?? {})
        )
      );
    }
  }
  if (effects.length === 0) return Effect.void;
  return Effect.all(effects).pipe(Effect.asVoid);
}

function logStateChanges(prev: SnapshotPayload, next: SnapshotPayload): void {
  if (!isDebugActivity()) return;
  const prevByKey = new Map<string, AgentSnapshot>();
  for (const agent of prev.agents) {
    prevByKey.set(identityForAgent(agent), agent);
  }
  for (const agent of next.agents) {
    const key = identityForAgent(agent);
    const prevAgent = prevByKey.get(key);
    if (!prevAgent || prevAgent.state !== agent.state) {
      logDebug(
        `state ${key} ${prevAgent?.state ?? "none"} -> ${agent.state} ` +
        `pid=${agent.pid ?? "?"} lastEventAt=${agent.lastEventAt ?? "?"} ` +
        `doing=${agent.doing ?? "?"}`
      );
    }
  }
}

function applyTestOverrides(snapshot: SnapshotPayload): SnapshotPayload {
  if (!activityTestMode || testActivity.size === 0) return snapshot;
  const agents = snapshot.agents.map((agent) => ({ ...agent }));
  const now = Date.now();
  for (const entry of testActivity.values()) {
    const laneId = entry.laneId;
    const match = agents.find((agent) => identityForAgent(agent) === laneId);
    const state = entry.active ? "active" : "idle";
    if (match) {
      match.state = state;
      match.lastEventAt = now;
      match.lastActivityAt = now;
      match.activityReason = "test";
      if (!match.summary) match.summary = {};
      match.summary.current = match.summary.current || `test:${entry.source}`;
      match.doing = match.doing || `test:${entry.source}`;
      continue;
    }
    agents.push({
      identity: laneId,
      id: laneId,
      pid: 0,
      cmd: "test",
      cmdShort: "test",
      kind: "tui",
      cpu: 0,
      mem: 0,
      state,
      title: `test:${laneId}`,
      doing: `test:${entry.source}`,
      summary: { current: `test:${entry.source}` },
      lastEventAt: now,
      lastActivityAt: now,
      activityReason: "test",
    });
  }
  return { ...snapshot, agents };
}

function scheduleHoldTick(nextTickAt: number | undefined): void {
  if (typeof nextTickAt !== "number" || !Number.isFinite(nextTickAt)) return;
  const now = Date.now();
  if (nextTickAt <= now) {
    requestTick("fast");
    return;
  }
  if (holdTickAt && nextTickAt >= holdTickAt - 5) return;
  holdTickAt = nextTickAt;
  if (holdTickTimeout) {
    clearTimeout(holdTickTimeout);
  }
  holdTickTimeout = setTimeout(() => {
    holdTickTimeout = null;
    holdTickAt = 0;
    requestTick("fast");
  }, Math.max(0, nextTickAt - Date.now()));
}

function broadcastSnapshot(snapshot: SnapshotPayload, deltaOps: DeltaOp[] = []): void {
  const payload = JSON.stringify(snapshot);
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const state = wsClients.get(client);
    if (state?.mode === "json" && state.ready) {
      sendDeltaEnvelope(client, deltaOps);
      continue;
    }
    client.send(payload);
  }
}

function emitSnapshot(snapshot: SnapshotPayload): void {
  logStateChanges(lastBaseSnapshot, snapshot);
  const prevSnapshot = lastSnapshot;
  lastBaseSnapshot = snapshot;
  lastSnapshot = applyTestOverrides(snapshot);
  scheduleHoldTick(snapshot.meta?.activity?.nextTickAt);
  const deltaOps = buildDelta(prevSnapshot, lastSnapshot);
  broadcastSnapshot(lastSnapshot, deltaOps);
}

function emitTestSnapshot(): void {
  if (!activityTestMode) return;
  const prevSnapshot = lastSnapshot;
  lastSnapshot = applyTestOverrides(lastBaseSnapshot);
  const deltaOps = buildDelta(prevSnapshot, lastSnapshot);
  broadcastSnapshot(lastSnapshot, deltaOps);
}

function checkScanStall(): void {
  if (!scanning || scanStartAt === null || scanMode === null) return;
  const now = Date.now();
  const elapsed = now - scanStartAt;
  if (elapsed < scanStallMs) return;
  if (scanLastStallAt && now - scanLastStallAt < scanStallMs) return;
  scanLastStallAt = now;
  process.stderr.write(
    `[consensus] scan stall detected mode=${scanMode} elapsed=${elapsed}ms\n`
  );
  void runPromise(recordScanStall(elapsed, scanMode)).catch((err) => {
    logRuntimeError("metrics", err);
  });
}

async function tick(): Promise<void> {
  if (scanning) return;
  if (!codexWatcher && fs.existsSync(codexSessionsDir)) {
    startCodexWatcher();
  }
  const mode = pendingMode ?? "fast";
  const includeActivity = true;
  pendingMode = null;
  scanning = true;
  let startedAt = Date.now();
  try {
    startedAt = Date.now();
    scanStartAt = startedAt;
    scanMode = mode;
    void runPromise(recordScanInFlight(true, mode)).catch((err) => {
      logRuntimeError("metrics", err);
    });
    const scanEffect = recordJobStart("scan")
      .pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: (signal) => scanCodexProcesses({ mode, includeActivity, signal }),
            catch: (err) => err as Error,
          }).pipe(Effect.timeout(`${scanTimeoutMs} millis`))
        )
      )
      .pipe(
        withSpan("scan.tick", {
          attributes: {
            "scan.mode": mode,
            "scan.include_activity": includeActivity,
          },
        }),
        Effect.tap((snapshot) => annotateActivityMeta(snapshot?.meta?.activity)),
        Effect.tap((snapshot) =>
          recordActiveSessions(snapshot.agents.length)
        ),
        Effect.tap(() =>
          recordJobComplete("scan", "ok", Date.now() - startedAt)
        ),
        Effect.tapError((err) =>
          Effect.all([
            recordJobComplete("scan", "error", Date.now() - startedAt),
            recordError("scan"),
            annotateSpan("error.type", err instanceof Error ? err.name : "error"),
            annotateSpan(
              "error.message",
              err instanceof Error ? err.message : String(err)
            ),
          ]).pipe(Effect.asVoid)
        ),
        Effect.catchAll((err) =>
          Effect.sync(() => {
            logRuntimeError("scan failed", err);
            return null;
          })
        )
      );

    const fiber = runFork(scanEffect);
    const exit = await runPromise(fiber.await);
    if (Exit.isSuccess(exit)) {
      const snapshot = exit.value;
      if (snapshot) emitSnapshot(snapshot);
    }
  } catch (err) {
    // Keep server alive on scan errors.
    logRuntimeError("scan crashed", err);
  } finally {
    const endedAt = Date.now();
    const durationMs =
      scanStartAt !== null ? endedAt - scanStartAt : endedAt - startedAt;
    if (scanMode) {
      void runPromise(recordScanDuration(durationMs, scanMode)).catch((err) => {
        logRuntimeError("metrics", err);
      });
      void runPromise(recordScanInFlight(false, scanMode)).catch((err) => {
        logRuntimeError("metrics", err);
      });
    }
    scanStartAt = null;
    scanMode = null;
    scanning = false;
    if (pendingMode) {
      setTimeout(() => void tick(), 0);
    }
  }
}

wss.on("connection", (socket) => {
  wsClients.set(socket, { mode: "legacy", ready: false });
  socket.send(JSON.stringify(lastSnapshot));

  socket.on("message", (data) => {
    let text: string | null = null;
    if (typeof data === "string") {
      text = data;
    } else if (Buffer.isBuffer(data)) {
      text = data.toString("utf8");
    } else if (Array.isArray(data)) {
      text = Buffer.concat(data).toString("utf8");
    } else if (data instanceof ArrayBuffer) {
      text = Buffer.from(data).toString("utf8");
    }
    if (!text) return;
    try {
      const message = JSON.parse(text);
      if (message?.v === 1 && message?.t === "hello") {
        const state = wsClients.get(socket);
        if (state) {
          state.mode = "json";
          state.ready = true;
        } else {
          wsClients.set(socket, { mode: "json", ready: true });
        }
        sendWelcome(socket);
        sendSnapshotEnvelope(socket, lastSnapshot);
      }
    } catch {
      // ignore malformed messages
    }
  });

  socket.on("close", () => {
    wsClients.delete(socket);
  });
});

function requestTick(mode: "fast" | "full"): void {
  if (pendingMode === "full") return;
  pendingMode = mode;
  if (!scanning) {
    setTimeout(() => void tick(), 0);
  }
}

function startCodexWatcher(): void {
  if (codexWatcher) return;
  if (!fs.existsSync(codexSessionsDir)) return;
  const watchOptions = codexWatchPoll
    ? {
      ignoreInitial: true,
      usePolling: true,
      interval: codexWatchInterval,
      binaryInterval: codexWatchBinaryInterval,
    }
    : { ignoreInitial: true };
  codexWatcher = chokidar.watch(
    path.join(codexSessionsDir, "**/*.jsonl"),
    watchOptions
  );
  codexWatcher.on("error", (err) => {
    process.stderr.write(`[consensus] codex watcher error: ${String(err)}\n`);
  });
  const onDirty = (filePath: string) => {
    markSessionDirty(path.resolve(filePath));
    requestTick("fast");
  };
  codexWatcher.on("add", onDirty);
  codexWatcher.on("change", onDirty);
  codexWatcher.on("unlink", onDirty);
}

function stopCodexWatcher(): Promise<void> | void {
  if (!codexWatcher) return;
  const closing = codexWatcher.close();
  codexWatcher = null;
  return closing;
}

function startOpenCodeListener(): void {
  if (unsubscribeOpenCode) return;
  unsubscribeOpenCode = onOpenCodeEvent(() => {
    requestTick("fast");
  });
}

function stopOpenCodeListener(): void {
  if (!unsubscribeOpenCode) return;
  unsubscribeOpenCode();
  unsubscribeOpenCode = null;
  stopOpenCodeEventStream();
}

registerActivityTestRoutes(app, {
  report: (laneId, source, active) => {
    testActivity.set(laneId, {
      laneId,
      source,
      active,
      updatedAt: Date.now(),
    });
    emitTestSnapshot();
  },
  state: (laneId) => testActivity.get(laneId) || null,
  reset: () => {
    testActivity.clear();
    emitTestSnapshot();
  },
  config: () => ({
    ok: true,
    pollMs,
    activityTestMode,
  }),
});

const pollLoop = Effect.forever(
  Effect.sleep(`${pollMs} millis`).pipe(Effect.tap(() => Effect.sync(() => requestTick("fast"))))
);
const stallLoop = Effect.forever(
  Effect.sleep(`${scanStallCheckMs} millis`).pipe(Effect.tap(() => Effect.sync(checkScanStall)))
);

/**
 * @deprecated Use `npx consensus-cli setup` instead.
 * Legacy notify hook installation via env var.
 * Kept for backward compatibility only.
 */
function installCodexNotifyHook(): void {
  if (!codexNotifyInstall) return;
  process.stderr.write(
    "[consensus] Warning: CONSENSUS_CODEX_NOTIFY_INSTALL is deprecated. " +
    "Use 'npx consensus-cli setup' for reliable Codex integration.\n"
  );
  const notifier = codexNotifyInstall.trim();
  if (!notifier) return;
  const script = `notify=["${notifier.replace(/"/g, "\\\"")}"]`;
  const args = ["config", "set", "-g", script];
  const child = spawn("codex", args, {
    stdio: "ignore",
    env: process.env,
    detached: true,
  });
  const timeout = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, codexNotifyInstallTimeout);
  child.on("error", () => clearTimeout(timeout));
  child.on("exit", () => clearTimeout(timeout));
  child.unref();
}

const runtime = runFork(
  Effect.scoped(
    Effect.gen(function* () {
      // Legacy notify hook install kept for backward compatibility.
      // Current Codex activity state comes from session JSONL tails; webhooks/watcher only trigger scans.
      yield* Effect.sync(() => installCodexNotifyHook());
      yield* Effect.acquireRelease(
        Effect.sync(() => startReloadWatcher()),
        () => Effect.promise(() => Promise.resolve(stopReloadWatcher()))
      );
      yield* Effect.acquireRelease(
        Effect.sync(() => startOpenCodeListener()),
        () => Effect.sync(() => stopOpenCodeListener())
      );
      yield* Effect.forkScoped(pollLoop);
      yield* Effect.forkScoped(stallLoop);
      return yield* Effect.never;
    }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          process.stderr.write(
            `[consensus] runtime error: ${String(err)}\n`
          );
        })
      )
    )
  )
);

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  process.stdout.write(`consensus dev server running on ${url}\n`);
});

requestTick("full");

async function shutdown(): Promise<void> {
  try {
    await runPromise(Fiber.interrupt(runtime));
  } finally {
    await disposeObservability().catch(() => undefined);
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
