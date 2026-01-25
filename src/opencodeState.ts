import type { AgentState } from "./types.js";
import type { ActivityHoldResult } from "./activity.js";
import { deriveStateWithHold } from "./activity.js";

export interface OpenCodeStateInput {
  cpu: number;
  hasError: boolean;
  lastEventAt?: number;
  inFlight?: boolean;
  status?: string;
  isServer?: boolean;
  now?: number;
  previousActiveAt?: number;
  cpuThreshold?: number;
  eventWindowMs?: number;
  holdMs?: number;
}

export function deriveOpenCodeState(input: OpenCodeStateInput): ActivityHoldResult {
  const status = input.status?.toLowerCase();
  const statusIsError = !!status && /error|failed|failure/.test(status);
  const statusIsActive = !!status && /running|active|processing/.test(status);
  const statusIsIdle = !!status && /idle|stopped|paused/.test(status);

  const activity = deriveStateWithHold({
    cpu: input.cpu,
    hasError: input.hasError,
    lastEventAt: input.lastEventAt,
    inFlight: input.inFlight,
    previousActiveAt: input.previousActiveAt,
    now: input.now,
    cpuThreshold: input.cpuThreshold,
    eventWindowMs: input.eventWindowMs,
    holdMs: input.holdMs,
  });

  let state: AgentState = activity.state;
  if (statusIsError) {
    state = "error";
  } else if (statusIsIdle) {
    state = "idle";
  } else if (statusIsActive && state !== "active") {
    state = "idle";
  }

  const cpuThreshold = input.cpuThreshold ?? Number(process.env.CONSENSUS_CPU_ACTIVE || 1);
  if (input.isServer) {
    state = input.cpu > cpuThreshold ? "active" : "idle";
  }

  if (state === "idle") {
    return { state, lastActiveAt: undefined };
  }

  return { state, lastActiveAt: activity.lastActiveAt };
}
