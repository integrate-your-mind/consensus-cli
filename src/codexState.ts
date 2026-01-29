import type { ActivityHoldResult } from "./activity.js";
import { deriveStateWithHold } from "./activity.js";

const DEFAULT_CODEX_CPU_SUSTAIN_MS = 500;
const DEFAULT_CODEX_INFLIGHT_IDLE_MS = 30_000;

export interface CodexStateInput {
  cpu: number;
  hasError: boolean;
  lastActivityAt?: number;
  lastInFlightSignalAt?: number;
  inFlight?: boolean;
  now?: number;
  previousActiveAt?: number;
  cpuThreshold?: number;
  eventWindowMs?: number;
  holdMs?: number;
  cpuActiveMs?: number;
  cpuSustainMs?: number;
  cpuSpikeThreshold?: number;
  inFlightIdleMs?: number;
  strictInFlight?: boolean;
}

export function deriveCodexState(input: CodexStateInput): ActivityHoldResult {
  const now = input.now ?? Date.now();
  if (input.strictInFlight) {
    const state = input.hasError ? "error" : input.inFlight ? "active" : "idle";
    const reason = input.hasError ? "error" : input.inFlight ? "in_flight" : "idle";
    return { state, lastActiveAt: input.inFlight ? now : undefined, reason };
  }
  const cpuThreshold =
    input.cpuThreshold ?? Number(process.env.CONSENSUS_CPU_ACTIVE || 1);
  const sustainMs =
    input.cpuSustainMs ??
    Number(process.env.CONSENSUS_CODEX_CPU_SUSTAIN_MS || DEFAULT_CODEX_CPU_SUSTAIN_MS);
  const spikeEnv = Number(process.env.CONSENSUS_CODEX_CPU_SPIKE || "");
  const spikeThreshold =
    input.cpuSpikeThreshold ??
    (Number.isFinite(spikeEnv) && spikeEnv > 0
      ? spikeEnv
      : Math.max(cpuThreshold * 10, 25));
  const envInFlightIdle = process.env.CONSENSUS_CODEX_INFLIGHT_IDLE_MS;
  let inFlightIdleMs = input.inFlightIdleMs;
  if (typeof inFlightIdleMs !== "number") {
    if (envInFlightIdle === undefined || envInFlightIdle.trim() === "") {
      inFlightIdleMs = DEFAULT_CODEX_INFLIGHT_IDLE_MS;
    } else {
      const parsed = Number(envInFlightIdle);
      if (Number.isFinite(parsed)) {
        inFlightIdleMs = parsed > 0 ? parsed : undefined;
      } else {
        inFlightIdleMs = DEFAULT_CODEX_INFLIGHT_IDLE_MS;
      }
    }
  } else if (inFlightIdleMs <= 0) {
    inFlightIdleMs = undefined;
  }

  let inFlight = input.inFlight;
  const lastActivityAt = input.lastActivityAt;
  const fallbackSignalAt =
    typeof input.previousActiveAt === "number" ? input.previousActiveAt : now;
  const inFlightSignalAt =
    typeof input.lastInFlightSignalAt === "number"
      ? input.lastInFlightSignalAt
      : typeof lastActivityAt === "number"
        ? lastActivityAt
        : fallbackSignalAt;
  const hasWork = typeof inFlightSignalAt === "number";
  const eventWindowMs =
    input.eventWindowMs ??
    Number(process.env.CONSENSUS_CODEX_EVENT_ACTIVE_MS || 300000);
  const recentWork =
    hasWork && typeof lastActivityAt === "number"
      ? now - lastActivityAt <= eventWindowMs
      : false;
  if (inFlight) {
    if (typeof inFlightIdleMs === "number" && now - inFlightSignalAt > inFlightIdleMs) {
      inFlight = false;
    }
  }

  const hasSignal = recentWork || !!inFlight;
  const sustained =
    hasSignal &&
    (input.cpu >= spikeThreshold ||
      (typeof input.cpuActiveMs === "number" && input.cpuActiveMs >= sustainMs));

  const cpu = hasSignal || sustained ? input.cpu : 0;

  return deriveStateWithHold({
    cpu,
    hasError: input.hasError,
    lastEventAt: recentWork ? lastActivityAt : undefined,
    inFlight,
    previousActiveAt: input.previousActiveAt,
    now,
    cpuThreshold,
    eventWindowMs,
    holdMs: input.holdMs,
  });
}
