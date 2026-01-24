import type { AgentState } from "./types.js";

const DEFAULT_CPU_THRESHOLD = 5;
const DEFAULT_EVENT_WINDOW_MS = 8000;

export interface ActivityInput {
  cpu: number;
  hasError: boolean;
  lastEventAt?: number;
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
  return cpuActive || eventActive ? "active" : "idle";
}
