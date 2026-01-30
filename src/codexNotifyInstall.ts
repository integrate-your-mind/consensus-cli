export function normalizeCodexNotifyInstall(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "0" || lowered === "false") return null;
  return trimmed;
}
