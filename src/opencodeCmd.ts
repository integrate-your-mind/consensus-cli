export type OpenCodeKind = "opencode-tui" | "opencode-cli" | "opencode-server";

export interface OpenCodeCommandInfo {
  kind: OpenCodeKind;
  mode?: "serve" | "web" | "run";
  prompt?: string;
}

const OPENCODE_BINARIES = new Set(["opencode", "opencode.exe"]);

function splitArgs(command: string): string[] {
  if (!command) return [];
  const args: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    const token = match[1] ?? match[2] ?? match[0];
    if (token) args.push(token);
  }
  return args;
}

function findOpenCodeIndex(parts: string[]): number {
  for (let i = 0; i < parts.length; i += 1) {
    const base = parts[i] ? parts[i].split(/[/\\\\]/).pop() || "" : "";
    const normalized = base.toLowerCase();
    if (OPENCODE_BINARIES.has(normalized)) return i;
  }
  return -1;
}

function findPrompt(parts: string[], startIndex: number): string | undefined {
  const skipFlags = new Set([
    "--cwd",
    "--model",
    "--agent",
    "--port",
    "--hostname",
    "--config",
    "--log-level",
  ]);
  for (let i = startIndex; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith("-")) {
      if (skipFlags.has(part)) {
        i += 1;
      }
      continue;
    }
    return part;
  }
  return undefined;
}

export function parseOpenCodeCommand(command: string): OpenCodeCommandInfo | null {
  const parts = splitArgs(command);
  const openIndex = findOpenCodeIndex(parts);
  if (openIndex === -1) return null;

  const next = parts[openIndex + 1];
  if (next === "serve" || next === "web") {
    return { kind: "opencode-server", mode: next };
  }
  const subcommandIndex = parts.slice(openIndex + 1).indexOf("run");
  if (next === "run" || subcommandIndex !== -1) {
    const runIndex = next === "run" ? openIndex + 1 : openIndex + 1 + subcommandIndex;
    const prompt = findPrompt(parts, runIndex + 1);
    return { kind: "opencode-cli", mode: "run", prompt };
  }
  if (parts.includes("--serve") || parts.includes("--web")) {
    return { kind: "opencode-server" };
  }
  if (parts.includes("--hostname") || parts.includes("--port")) {
    return { kind: "opencode-server" };
  }
  return { kind: "opencode-tui" };
}

export function summarizeOpenCodeCommand(
  command: string
): (OpenCodeCommandInfo & { doing: string }) | null {
  const info = parseOpenCodeCommand(command);
  if (!info) return null;
  if (info.mode === "serve") return { ...info, doing: "opencode serve" };
  if (info.mode === "web") return { ...info, doing: "opencode web" };
  if (info.mode === "run") {
    return info.prompt
      ? { ...info, doing: `opencode run: ${info.prompt}` }
      : { ...info, doing: "opencode run" };
  }
  return { ...info, doing: "opencode" };
}
