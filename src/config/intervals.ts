export function resolvePollMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CONSENSUS_POLL_MS;
  const parsed =
    raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : 250;
  // Keep scanning responsive but avoid pathological tight loops.
  return Math.max(50, value);
}

export function resolveOpenCodeTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.CONSENSUS_OPENCODE_TIMEOUT_MS;
  const parsed =
    raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : 5000;
  // 0 disables the timeout in opencodeApi.ts; allow it if explicitly set.
  if (value === 0) return 0;
  return Math.max(1, value);
}
