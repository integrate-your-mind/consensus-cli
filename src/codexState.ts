import type { ActivityHoldResult } from "./activity.js";
import { deriveStateWithHold } from "./activity.js";

const DEFAULT_CODEX_CPU_SUSTAIN_MS = 500;
const DEFAULT_CODEX_INFLIGHT_IDLE_MS = 30_000;
const DEFAULT_CODEX_HOLD_MS = 0;

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
    typeof input.cpuActiveMs === "number" && input.cpuActiveMs >= sustainMs;

  const cpu = hasSignal || sustained ? input.cpu : 0;

  const holdMs =
    input.holdMs ??
    Number(process.env.CONSENSUS_CODEX_ACTIVE_HOLD_MS || DEFAULT_CODEX_HOLD_MS);

  return deriveStateWithHold({
    cpu,
    hasError: input.hasError,
    lastEventAt: recentWork ? lastActivityAt : undefined,
    inFlight,
    previousActiveAt: input.previousActiveAt,
    now,
    cpuThreshold,
    eventWindowMs,
    holdMs,
  });
}

export interface CodexEventStateInput {
  inFlight?: boolean;
  lastActivityAt?: number;
  hasError: boolean;
  now?: number;
  holdMs?: number;
  idleMs?: number;
}

/**
 * Event-driven Codex state (notify only)
 */
export function deriveCodexEventState(
  input: CodexEventStateInput
): ActivityHoldResult {
  const now = input.now ?? Date.now();
  const holdMs =
    typeof input.holdMs === "number" ? input.holdMs : DEFAULT_CODEX_HOLD_MS;
  const idleMs =
    typeof input.idleMs === "number"
      ? input.idleMs
      : Number(process.env.CONSENSUS_CODEX_EVENT_IDLE_MS || 20000);
  const lastActivityAt = input.lastActivityAt;
  const hasRecentEvent =
    typeof lastActivityAt === "number" && now - lastActivityAt <= holdMs;
  const eventStale =
    typeof lastActivityAt === "number" &&
    Number.isFinite(idleMs) &&
    idleMs > 0 &&
    now - lastActivityAt > idleMs;

  if (input.hasError) {
    return { state: "error", lastActiveAt: lastActivityAt, reason: "error" };
  }

  if (input.inFlight && !eventStale) {
    return {
      state: "active",
      lastActiveAt: lastActivityAt ?? now,
      reason: "event_in_flight",
    };
  }

  if (input.inFlight && eventStale) {
    return {
      state: "idle",
      lastActiveAt: lastActivityAt,
      reason: "event_timeout",
    };
  }

  if (hasRecentEvent) {
    return {
      state: "active",
      lastActiveAt: lastActivityAt,
      reason: "event_hold",
    };
  }

  return {
    state: "idle",
    lastActiveAt: lastActivityAt,
    reason: "event_idle",
  };
}
