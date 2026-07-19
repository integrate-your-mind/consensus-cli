#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ACTIVE_STATES = new Set(["active", "error"]);

function parseArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8787/api/snapshot?cached=1",
    intervalMs: 250,
    durationMs: 120000,
    windowMs: 10000,
    out: "tmp/flicker-summary.json",
    outJsonl: "",
    maxIntervalFactor: 2,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }
    if (raw === "--verbose" || raw === "-v") {
      args.verbose = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("-")) continue;
    if (raw === "--endpoint") {
      args.endpoint = next;
      i += 1;
      continue;
    }
    if (raw === "--interval-ms") {
      args.intervalMs = Number(next);
      i += 1;
      continue;
    }
    if (raw === "--duration-ms") {
      args.durationMs = Number(next);
      i += 1;
      continue;
    }
    if (raw === "--window-ms") {
      args.windowMs = Number(next);
      i += 1;
      continue;
    }
    if (raw === "--out") {
      args.out = next;
      i += 1;
      continue;
    }
    if (raw === "--out-jsonl") {
      args.outJsonl = next;
      i += 1;
      continue;
    }
    if (raw === "--max-interval-factor") {
      args.maxIntervalFactor = Number(next);
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.intervalMs) || args.intervalMs <= 0) args.intervalMs = 250;
  if (!Number.isFinite(args.durationMs) || args.durationMs <= 0) args.durationMs = 120000;
  if (!Number.isFinite(args.windowMs) || args.windowMs <= 0) args.windowMs = 10000;
  if (!Number.isFinite(args.maxIntervalFactor) || args.maxIntervalFactor <= 0) {
    args.maxIntervalFactor = 2;
  }

  return args;
}

function agentIdentity(agent) {
  return (
    agent?.identity ||
    agent?.sessionPath ||
    agent?.sessionId ||
    agent?.id ||
    (typeof agent?.pid === "number" ? `pid:${agent.pid}` : "unknown")
  );
}

function normalizeState(state) {
  const value = typeof state === "string" ? state.trim().toLowerCase() : "idle";
  return ACTIVE_STATES.has(value) ? "active" : "idle";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  return [
    "Usage: node scripts/flicker-detect.js [options]",
    "",
    "Options:",
    "  --endpoint <url>       Snapshot endpoint (default: http://127.0.0.1:8787/api/snapshot?cached=1)",
    "  --interval-ms <ms>     Poll interval (default: 250)",
    "  --duration-ms <ms>     Total run duration (default: 120000)",
    "  --window-ms <ms>       Flicker window for active->idle->active (default: 10000)",
    "  --out <path>           Write JSON summary (default: tmp/flicker-summary.json)",
    "  --out-jsonl <path>     Write JSONL transition log (default: <out>.transitions.jsonl)",
    "  --max-interval-factor  Fail if effective interval exceeds intervalMs * factor (default: 2)",
    "  --verbose, -v          Print transitions as they occur",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }

  const startedAt = Date.now();
  const endAt = startedAt + args.durationMs;

  const perAgent = new Map();
  const transitionsLog = [];
  const errors = [];
  let polls = 0;
  let okPolls = 0;

  while (Date.now() < endAt) {
    const tickStartedAt = Date.now();
    polls += 1;
    let payload;
    try {
      const res = await fetch(args.endpoint, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new Error(`snapshot ${res.status}`);
      }
      payload = await res.json();
      okPolls += 1;
    } catch (err) {
      errors.push({ ts: Date.now(), error: String(err) });
      const elapsed = Date.now() - tickStartedAt;
      await sleep(Math.max(0, args.intervalMs - elapsed));
      continue;
    }

    const agents = Array.isArray(payload?.agents) ? payload.agents : [];
    const seen = new Set();

    for (const agent of agents) {
      const id = String(agentIdentity(agent));
      seen.add(id);
      const state = normalizeState(agent?.state);
      let entry = perAgent.get(id);
      if (!entry) {
        entry = {
          identity: id,
          // Treat first sighting as a transition from idle -> current state so we can
          // build a complete active window in the output.
          lastState: "idle",
          lastSeenAt: Date.now(),
          missingTicks: 0,
          transitions: [],
          flickers: [],
          flickerCount: 0,
          lastActiveToIdleAt: undefined,
        };
        perAgent.set(id, entry);
      }

      entry.lastSeenAt = Date.now();
      const prev = entry.lastState;
      if (prev !== state) {
        const ts = Date.now();
        entry.transitions.push({ ts, from: prev, to: state });
        transitionsLog.push({ ts, identity: id, from: prev, to: state });
        if (args.verbose) {
          process.stdout.write(`[${new Date(ts).toISOString()}] ${id} ${prev} -> ${state}\n`);
        }
        if (prev === "active" && state === "idle") {
          entry.lastActiveToIdleAt = ts;
        } else if (prev === "idle" && state === "active") {
          const idleAt = entry.lastActiveToIdleAt;
          if (typeof idleAt === "number") {
            const deltaMs = ts - idleAt;
            if (deltaMs <= args.windowMs) {
              entry.flickerCount += 1;
              entry.flickers.push({ idleAt, activeAt: ts, deltaMs });
            }
          }
          entry.lastActiveToIdleAt = undefined;
        }
        entry.lastState = state;
      }
    }

    const tickFinishedAt = Date.now();
    for (const entry of perAgent.values()) {
      if (!seen.has(entry.identity)) {
        entry.missingTicks += 1;
        if (entry.lastState !== "idle") {
          const prev = entry.lastState;
          entry.transitions.push({ ts: tickFinishedAt, from: prev, to: "idle", missing: true });
          transitionsLog.push({
            ts: tickFinishedAt,
            identity: entry.identity,
            from: prev,
            to: "idle",
            missing: true,
          });
          if (args.verbose) {
            process.stdout.write(
              `[${new Date(tickFinishedAt).toISOString()}] ${entry.identity} ${prev} -> idle (missing)\n`
            );
          }
          entry.lastActiveToIdleAt = tickFinishedAt;
          entry.lastState = "idle";
        }
      }
    }

    const elapsed = Date.now() - tickStartedAt;
    await sleep(Math.max(0, args.intervalMs - elapsed));
  }

  const finishedAt = Date.now();
  const effectiveIntervalMs = okPolls > 0 ? (finishedAt - startedAt) / okPolls : undefined;
  const intervalBudgetMs = args.intervalMs * args.maxIntervalFactor;
  const samplingOk =
    typeof effectiveIntervalMs === "number"
      ? effectiveIntervalMs <= intervalBudgetMs
      : false;
  const samplingReason = samplingOk
    ? undefined
    : okPolls === 0
      ? "no_successful_polls"
      : `effective_interval_ms_exceeds_budget:${Math.round(effectiveIntervalMs || 0)}>${Math.round(intervalBudgetMs)}`;
  const agentSummaries = Array.from(perAgent.values())
    .map((entry) => ({
      identity: entry.identity,
      lastState: entry.lastState,
      lastSeenAt: entry.lastSeenAt,
      missingTicks: entry.missingTicks,
      transitionCount: entry.transitions.length,
      transitions: entry.transitions,
      flickerCount: entry.flickerCount,
      flickers: entry.flickers,
    }))
    .sort((a, b) => b.flickerCount - a.flickerCount || a.identity.localeCompare(b.identity));

  const totalFlickerCount = agentSummaries.reduce((acc, a) => acc + (a.flickerCount || 0), 0);
  const transitionsOut =
    args.outJsonl && args.outJsonl.trim()
      ? args.outJsonl
      : args.out.endsWith(".json")
        ? args.out.replace(/\.json$/, ".transitions.jsonl")
        : `${args.out}.transitions.jsonl`;
  const summary = {
    endpoint: args.endpoint,
    intervalMs: args.intervalMs,
    durationMs: args.durationMs,
    windowMs: args.windowMs,
    maxIntervalFactor: args.maxIntervalFactor,
    startedAt,
    finishedAt,
    polls,
    okPolls,
    effectiveIntervalMs,
    samplingOk,
    samplingReason,
    errorCount: errors.length,
    errors,
    totalFlickerCount,
    agents: agentSummaries,
    transitionsPath: transitionsOut,
  };

  const outPath = path.resolve(args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const transitionsPath = path.resolve(transitionsOut);
  await fs.mkdir(path.dirname(transitionsPath), { recursive: true });
  const transitionsBody =
    transitionsLog.length > 0
      ? transitionsLog.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
      : "";
  await fs.writeFile(
    transitionsPath,
    transitionsBody,
    "utf8"
  );

  if (okPolls === 0) return 2;
  if (!samplingOk) return 2;
  if (totalFlickerCount > 0) return 1;
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 2;
  });
