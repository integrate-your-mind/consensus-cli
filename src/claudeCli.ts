export type ClaudeKind = "claude-tui" | "claude-cli";

export interface ClaudeCommandInfo {
  kind: ClaudeKind;
  prompt?: string;
  resume?: string;
  continued?: boolean;
  model?: string;
  print?: boolean;
}

const CLAUDE_BINARIES = new Set(["claude", "claude.exe"]);

export function splitArgs(command: string): string[] {
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

function findClaudeIndex(parts: string[]): number {
  for (let i = 0; i < parts.length; i += 1) {
    const base = parts[i] ? parts[i].split(/[/\\]/).pop() || "" : "";
    if (CLAUDE_BINARIES.has(base)) return i;
  }
  return -1;
}

function readFlagValue(parts: string[], flag: string): string | undefined {
  const idx = parts.indexOf(flag);
  if (idx === -1) return undefined;
  const value = parts[idx + 1];
  if (!value || value.startsWith("-")) return undefined;
  return value;
}

function findPrompt(parts: string[], startIndex: number): string | undefined {
  for (let i = startIndex; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (part === "-p" || part === "--print") {
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) return next;
    }
    if (part.startsWith("-")) {
      const skipFlags = new Set([
        "--output-format",
        "--input-format",
        "--model",
        "--max-turns",
        "--max-budget-usd",
        "--tools",
        "--allowedTools",
        "--disallowedTools",
        "--resume",
        "-r",
        "--session-id",
        "--continue",
        "-c",
      ]);
      if (skipFlags.has(part)) {
        i += 1;
      }
      continue;
    }
    return part;
  }
  return undefined;
}

export function parseClaudeCommand(command: string): ClaudeCommandInfo | null {
  const parts = splitArgs(command);
  const claudeIndex = findClaudeIndex(parts);
  if (claudeIndex === -1) return null;

  const hasPrint = parts.includes("-p") || parts.includes("--print");
  const continued = parts.includes("--continue") || parts.includes("-c");
  const resume = readFlagValue(parts, "--resume") || readFlagValue(parts, "-r");
  const model = readFlagValue(parts, "--model");
  const prompt = findPrompt(parts, claudeIndex + 1);

  return {
    kind: hasPrint ? "claude-cli" : "claude-tui",
    prompt,
    resume,
    continued,
    model,
    print: hasPrint,
  };
}

export function summarizeClaudeCommand(command: string): ClaudeCommandInfo & { doing: string } | null {
  const info = parseClaudeCommand(command);
  if (!info) return null;
  if (info.prompt) {
    return { ...info, doing: `prompt: ${info.prompt}` };
  }
  if (info.resume) {
    return { ...info, doing: `resume: ${info.resume}` };
  }
  if (info.continued) {
    return { ...info, doing: "continue" };
  }
  if (info.print) {
    return { ...info, doing: "claude print" };
  }
  return { ...info, doing: "claude" };
}
