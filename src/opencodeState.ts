import type { AgentState } from "./types.js";
import type { ActivityHoldResult } from "./activity.js";
import { deriveStateWithHold } from "./activity.js";
import { DISABLE_INFLIGHT_DECAY, INFLIGHT_CONFIG } from "./config/inflight.js";

export interface OpenCodeStateInput {
  hasError: boolean;
  lastEventAt?: number;
  lastActivityAt?: number;
  inFlight?: boolean;
  status?: string;
  isServer?: boolean;
  now?: number;
  previousActiveAt?: number;
  eventWindowMs?: number;
  holdMs?: number;
  inFlightIdleMs?: number;
  strictInFlight?: boolean;
}

export function deriveOpenCodeState(input: OpenCodeStateInput): ActivityHoldResult {
  const status = input.status?.toLowerCase();
  const statusIsError = !!status && /error|failed|failure/.test(status);
  const statusIsActive = !!status && /running|active|processing/.test(status);
  const statusIsIdle = !!status && /idle|stopped|paused/.test(status);
  const now = input.now ?? Date.now();
  const activityAt =
    typeof input.lastActivityAt === "number" ? input.lastActivityAt : undefined;
  const eventAt = typeof input.lastEventAt === "number" ? input.lastEventAt : undefined;
  if (input.strictInFlight) {
    const state =
      input.hasError || statusIsError ? "error" : input.inFlight ? "active" : "idle";
    const reason =
      input.hasError || statusIsError ? "error" : input.inFlight ? "in_flight" : "idle";
    const lastActiveAt = input.inFlight ? activityAt ?? eventAt ?? now : undefined;
    return { state, lastActiveAt, reason };
  }
  const holdMs =
    input.holdMs ?? Number(process.env.CONSENSUS_OPENCODE_ACTIVE_HOLD_MS || 3000);
  const envInFlightIdle = INFLIGHT_CONFIG.opencode.idleMs;
  const envInFlightTimeout = INFLIGHT_CONFIG.opencode.timeoutMs;
  let inFlightIdleMs: number | undefined =
    input.inFlightIdleMs ?? envInFlightIdle ?? envInFlightTimeout;
  if (inFlightIdleMs !== DISABLE_INFLIGHT_DECAY) {
    if (
      typeof inFlightIdleMs !== "number" ||
      !Number.isFinite(inFlightIdleMs) ||
      inFlightIdleMs <= 0
    ) {
      inFlightIdleMs = undefined;
    }
  }
  const eventWindowMs =
    input.eventWindowMs ?? Number(process.env.CONSENSUS_OPENCODE_EVENT_ACTIVE_MS || 1000);
  const previousActiveAt = input.previousActiveAt;
  let inFlight = input.inFlight;
  const recentActivity =
    typeof activityAt === "number" && now - activityAt <= eventWindowMs;
  const hasNewActivity =
    recentActivity &&
    (typeof previousActiveAt !== "number" || activityAt > previousActiveAt);
  const decayAt =
    typeof activityAt === "number" && typeof eventAt === "number"
      ? Math.max(activityAt, eventAt)
      : activityAt ?? eventAt;
  if (
    inFlight &&
    inFlightIdleMs !== DISABLE_INFLIGHT_DECAY &&
    typeof inFlightIdleMs === "number" &&
    typeof decayAt === "number" &&
    now - decayAt > inFlightIdleMs
  ) {
    inFlight = false;
  }
  const activity = deriveStateWithHold({
    cpu: 0,
    hasError: input.hasError,
    lastEventAt: hasNewActivity ? activityAt : undefined,
    inFlight,
    previousActiveAt,
    now,
    cpuThreshold: Infinity,
    eventWindowMs,
    holdMs,
  });

  let state: AgentState = activity.state;
  let reason = activity.reason;
  if (statusIsError) {
    state = "error";
    reason = "status_error";
  } else if (statusIsIdle && !inFlight) {
    state = "idle";
    reason = "status_idle";
  } else if (statusIsActive && state !== "active") {
    if (!activity.lastActiveAt) {
      state = "idle";
      reason = "status_active_no_signal";
    }
  }

  if (state === "idle") {
    return { state, lastActiveAt: activity.lastActiveAt, reason };
  }

  return { state, lastActiveAt: activity.lastActiveAt, reason };
}
