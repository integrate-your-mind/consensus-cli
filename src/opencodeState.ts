import type { AgentState } from "./types.js";
import type { ActivityHoldResult } from "./activity.js";
import { deriveStateWithHold } from "./activity.js";

const DEFAULT_OPENCODE_INFLIGHT_TIMEOUT_MS = 2500;

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
  if (input.strictInFlight) {
    const state =
      input.hasError || statusIsError ? "error" : input.inFlight ? "active" : "idle";
    const reason =
      input.hasError || statusIsError ? "error" : input.inFlight ? "in_flight" : "idle";
    return { state, lastActiveAt: input.inFlight ? now : undefined, reason };
  }
  const holdMs =
    input.holdMs ?? Number(process.env.CONSENSUS_OPENCODE_ACTIVE_HOLD_MS || 0);
  const envInFlightIdle = process.env.CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS;
  const envInFlightTimeout = process.env.CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS;
  let inFlightIdleMs: number | undefined =
    input.inFlightIdleMs ??
    (envInFlightIdle !== undefined
      ? Number(envInFlightIdle)
      : envInFlightTimeout !== undefined
        ? Number(envInFlightTimeout)
        : DEFAULT_OPENCODE_INFLIGHT_TIMEOUT_MS);
  if (
    typeof inFlightIdleMs !== "number" ||
    !Number.isFinite(inFlightIdleMs) ||
    inFlightIdleMs <= 0
  ) {
    inFlightIdleMs = undefined;
  }
  const eventWindowMs =
    input.eventWindowMs ?? Number(process.env.CONSENSUS_OPENCODE_EVENT_ACTIVE_MS || 1000);
  const activityAt =
    typeof input.lastActivityAt === "number" ? input.lastActivityAt : undefined;
  const previousActiveAt = input.previousActiveAt;
  let inFlight = input.inFlight;
  const recentActivity =
    typeof activityAt === "number" && now - activityAt <= eventWindowMs;
  const hasNewActivity =
    recentActivity &&
    (typeof previousActiveAt !== "number" || activityAt > previousActiveAt);
  if (
    inFlight &&
    typeof inFlightIdleMs === "number" &&
    typeof activityAt === "number" &&
    now - activityAt > inFlightIdleMs
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
