export function mergeLastActiveAt(
  next?: number,
  cached?: number
): number | undefined {
  return typeof next === "number" ? next : cached;
}
