import type { AgentState } from "./types.js";

const DEFAULT_CPU_THRESHOLD = 1;
const DEFAULT_EVENT_WINDOW_MS = 300000;
const DEFAULT_ACTIVE_HOLD_MS = 600000;

export interface ActivityInput {
  cpu: number;
  hasError: boolean;
  lastEventAt?: number;
  inFlight?: boolean;
  now?: number;
  cpuThreshold?: number;
  eventWindowMs?: number;
}

export function deriveState(input: ActivityInput): AgentState {
  if (input.hasError) return "error";
  const now = input.now ?? Date.now();
  const cpuThreshold =
    input.cpuThreshold ?? Number(process.env.CONSENSUS_CPU_ACTIVE || DEFAULT_CPU_THRESHOLD);
  const eventWindowMs =
    input.eventWindowMs ??
    Number(process.env.CONSENSUS_EVENT_ACTIVE_MS || DEFAULT_EVENT_WINDOW_MS);
  const cpuActive = input.cpu > cpuThreshold;
  const eventActive =
    typeof input.lastEventAt === "number" &&
    now - input.lastEventAt <= eventWindowMs;
  const inFlight = !!input.inFlight;
  return cpuActive || eventActive || inFlight ? "active" : "idle";
}

export interface ActivityHoldInput extends ActivityInput {
  previousActiveAt?: number;
  holdMs?: number;
}

export interface ActivityHoldResult {
  state: AgentState;
  lastActiveAt?: number;
  reason?: string;
  baseState?: AgentState;
}

export function deriveStateWithHold(input: ActivityHoldInput): ActivityHoldResult {
  const now = input.now ?? Date.now();
  const holdMs =
    input.holdMs ?? Number(process.env.CONSENSUS_ACTIVE_HOLD_MS || DEFAULT_ACTIVE_HOLD_MS);
  const cpuThreshold =
    input.cpuThreshold ?? Number(process.env.CONSENSUS_CPU_ACTIVE || DEFAULT_CPU_THRESHOLD);
  const eventWindowMs =
    input.eventWindowMs ?? Number(process.env.CONSENSUS_EVENT_ACTIVE_MS || DEFAULT_EVENT_WINDOW_MS);
  const cpuActive = input.cpu > cpuThreshold;
  const eventActive =
    typeof input.lastEventAt === "number" && now - input.lastEventAt <= eventWindowMs;
  const inFlight = !!input.inFlight;
  const baseState = deriveState({ ...input, now, cpuThreshold, eventWindowMs });
  let reason = "idle";
  if (input.hasError) {
    reason = "error";
  } else if (baseState === "active") {
    if (inFlight) reason = "in_flight";
    else if (eventActive) reason = "event";
    else if (cpuActive) reason = "cpu";
    else reason = "active";
  }
  let lastActiveAt = input.previousActiveAt;
  if (baseState === "active") {
    lastActiveAt = now;
  }
  if (
    baseState === "idle" &&
    typeof lastActiveAt === "number" &&
    now - lastActiveAt <= holdMs
  ) {
    return { state: "active", lastActiveAt, reason: "hold", baseState };
  }
  return { state: baseState, lastActiveAt, reason, baseState };
}
