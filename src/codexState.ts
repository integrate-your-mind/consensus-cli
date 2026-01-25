import type { ActivityHoldResult } from "./activity.js";
import { deriveStateWithHold } from "./activity.js";

export interface CodexStateInput {
  cpu: number;
  hasError: boolean;
  lastActivityAt?: number;
  inFlight?: boolean;
  now?: number;
  previousActiveAt?: number;
  cpuThreshold?: number;
  eventWindowMs?: number;
  holdMs?: number;
}

export function deriveCodexState(input: CodexStateInput): ActivityHoldResult {
  const cpu =
    input.lastActivityAt || input.inFlight ? input.cpu : 0;

  return deriveStateWithHold({
    cpu,
    hasError: input.hasError,
    lastEventAt: input.lastActivityAt,
    inFlight: input.inFlight,
    previousActiveAt: input.previousActiveAt,
    now: input.now,
    cpuThreshold: input.cpuThreshold,
    eventWindowMs: input.eventWindowMs,
    holdMs: input.holdMs,
  });
}
