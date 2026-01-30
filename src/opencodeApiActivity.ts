export function shouldUseOpenCodeApiActivityAt(input: {
  status?: string;
  apiUpdatedAt?: number;
  apiCreatedAt?: number;
}): boolean {
  const status = input.status?.toLowerCase();
  const statusIsIdle = !!status && /idle|stopped|paused/.test(status);
  if (statusIsIdle) return false;
  return (
    typeof input.apiUpdatedAt === "number" || typeof input.apiCreatedAt === "number"
  );
}
