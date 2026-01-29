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
  // For Codex, we need to be careful about CPU spikes without activity signals.
  // The original behavior was to ignore CPU when there's no activity signal,
  // which prevents false positives from idle background processes.
  //
  // However, we should still respect the hold mechanism - if we were previously
  // active and are now in the hold period, we should stay active.
  //
  // The key insight: CPU alone is NOT a reliable activity signal for Codex.
  // We need either lastActivityAt or inFlight to consider the agent working.
  
  const hasActivitySignal = input.lastActivityAt || input.inFlight;
  
  // If there's no activity signal, suppress CPU to prevent false positives
  // This is the original intended behavior for Codex
  const cpu = hasActivitySignal ? input.cpu : 0;

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
