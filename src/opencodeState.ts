import type { AgentState } from "./types.js";
import type { ActivityHoldResult } from "./activity.js";
import { deriveStateWithHold } from "./activity.js";

const DEFAULT_OPENCODE_INFLIGHT_TIMEOUT_MS = 15000;

export interface OpenCodeStateInput {
  cpu: number;
  hasError: boolean;
  lastEventAt?: number;
  lastActivityAt?: number;
  inFlight?: boolean;
  status?: string;
  isServer?: boolean;
  now?: number;
  previousActiveAt?: number;
  cpuThreshold?: number;
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
    if (input.isServer) {
      if (input.hasError || statusIsError) return { state: "error", lastActiveAt: undefined };
      return { state: "idle", lastActiveAt: undefined };
    }
    const state =
      input.hasError || statusIsError ? "error" : input.inFlight ? "active" : "idle";
    const reason =
      input.hasError || statusIsError ? "error" : input.inFlight ? "in_flight" : "idle";
    return { state, lastActiveAt: input.inFlight ? now : undefined, reason };
  }
  const cpuThreshold = input.cpuThreshold ?? Number(process.env.CONSENSUS_CPU_ACTIVE || 1);
  const holdMs =
    input.holdMs ?? Number(process.env.CONSENSUS_OPENCODE_ACTIVE_HOLD_MS || 1000);
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
  const cpuActive = input.cpu >= cpuThreshold;
  if (
    inFlight &&
    typeof inFlightIdleMs === "number" &&
    typeof activityAt === "number" &&
    now - activityAt > inFlightIdleMs
  ) {
    inFlight = false;
  }
  const hasEvidence = hasNewActivity || !!inFlight || cpuActive;

  const activity = deriveStateWithHold({
    cpu: hasEvidence ? input.cpu : 0,
    hasError: input.hasError,
    lastEventAt: hasNewActivity ? activityAt : undefined,
    inFlight,
    previousActiveAt,
    now,
    cpuThreshold,
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

  if (input.isServer) {
    if (state === "error") {
      return { state, lastActiveAt: activity.lastActiveAt, reason };
    }
    return {
      state: "idle",
      lastActiveAt: previousActiveAt ?? activity.lastActiveAt,
      reason: "server",
    };
  }

  if (state === "idle") {
    return { state, lastActiveAt: activity.lastActiveAt, reason };
  }

  return { state, lastActiveAt: activity.lastActiveAt, reason };
}
