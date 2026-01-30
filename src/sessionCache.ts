export const START_MS_EPSILON_MS = 1000;

export const isStartMsMismatch = (
  cached?: number,
  current?: number,
  epsilonMs: number = START_MS_EPSILON_MS
): boolean => {
  if (typeof cached !== "number" || typeof current !== "number") return false;
  return Math.abs(cached - current) > epsilonMs;
};

export const resetSessionCachesOnRestart = (input: {
  pid: number;
  cachedStartMs?: number;
  currentStartMs?: number;
  activityCache: Map<string, { startMs?: number }>;
  sessionCache?: Map<number, { sessionId: string; lastSeenAt: number }>;
  epsilonMs?: number;
}): boolean => {
  const mismatch = isStartMsMismatch(
    input.cachedStartMs,
    input.currentStartMs,
    input.epsilonMs
  );
  if (!mismatch) return false;
  input.activityCache.delete(`${input.pid}`);
  input.sessionCache?.delete(input.pid);
  return true;
};
