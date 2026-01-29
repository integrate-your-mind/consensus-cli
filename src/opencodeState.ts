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
  
  // Handle error state first - this always takes priority
  if (statusIsError) {
    state = "error";
  } else if (statusIsIdle) {
    // Status explicitly says idle - respect that unless we're in a hold period
    // This prevents flickering when status reports idle but hold is active
    if (state !== "active" || !activity.lastActiveAt) {
      state = "idle";
    }
  } else if (statusIsActive) {
    // Status indicates active (running/processing), but we need evidence
    // to actually show as active. This prevents false positives when
    // a process reports "running" but isn't actually doing work.
    //
    // CRITICAL: Only upgrade to active if we have real evidence of work:
    // - inFlight flag is set
    // - Recent event activity
    // - CPU above threshold
    // - Already in active hold period
    //
    // If status says "running" but there's no evidence, stay idle.
    // This is the expected behavior per the test case.
    const hasEvidence = 
      input.inFlight ||
      (typeof input.lastEventAt === "number") ||
      (input.cpu > (input.cpuThreshold ?? 1)) ||
      (state === "active" && activity.lastActiveAt);
    
    if (!hasEvidence) {
      state = "idle";
    }
  }

  const cpuThreshold = input.cpuThreshold ?? Number(process.env.CONSENSUS_CPU_ACTIVE || 1);
  if (input.isServer) {
    // Server mode: use CPU as primary indicator but respect hold period
    const cpuActive = input.cpu > cpuThreshold;
    if (cpuActive) {
      state = "active";
    } else if (state === "active" && activity.lastActiveAt) {
      // Keep active during hold period even for servers
      state = "active";
    } else {
      state = "idle";
    }
  }

  // CRITICAL FIX: Always preserve lastActiveAt for the hold mechanism
  // This allows the hold period to work correctly across scan cycles
  return { state, lastActiveAt: activity.lastActiveAt };
}
