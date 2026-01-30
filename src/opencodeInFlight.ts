export interface OpenCodeInFlightSignals {
  sseInFlight?: boolean;
  sseLastActivityAt?: number;
  apiInFlight?: boolean;
  apiLastActivityAt?: number;
}

export type OpenCodeInFlightSource = "api" | "sse";

export const resolveOpenCodeInFlight = (
  signals: OpenCodeInFlightSignals
): { inFlight: boolean; source: OpenCodeInFlightSource } => {
  const { sseInFlight, sseLastActivityAt, apiInFlight, apiLastActivityAt } = signals;

  if (typeof apiInFlight !== "boolean") {
    return { inFlight: !!sseInFlight, source: "sse" };
  }

  if (typeof sseInFlight !== "boolean") {
    return { inFlight: apiInFlight, source: "api" };
  }

  if (sseInFlight === apiInFlight) {
    return { inFlight: apiInFlight, source: "api" };
  }

  const sseAt = typeof sseLastActivityAt === "number" ? sseLastActivityAt : 0;
  const apiAt = typeof apiLastActivityAt === "number" ? apiLastActivityAt : 0;

  if (sseAt === apiAt) {
    return { inFlight: apiInFlight, source: "api" };
  }

  return sseAt > apiAt
    ? { inFlight: sseInFlight, source: "sse" }
    : { inFlight: apiInFlight, source: "api" };
};
