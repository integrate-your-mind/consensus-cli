import path from "node:path";

const CODEX_BINARIES = new Set([
  "codex",
  "codex.exe",
  "codex-cli",
  "codex-cli.exe",
]);

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

export function isCodexBinary(value: string | undefined): boolean {
  if (!value) return false;
  const cleaned = stripQuotes(value);
  const base = path.basename(cleaned).toLowerCase();
  return CODEX_BINARIES.has(base);
}

export function hasCodexVendorPath(cmdLine: string): boolean {
  return /[\\/]+codex[\\/]+vendor[\\/]+/i.test(cmdLine);
}

export function hasCodexToken(cmdLine: string): boolean {
  return (
    /(?:^|\s|[\\/])codex(?:-cli)?(\.exe)?(?:\s|$)/i.test(cmdLine) ||
    /[\\/]+codex(?:-cli)?(\.exe)?/i.test(cmdLine)
  );
}
