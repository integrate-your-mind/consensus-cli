export interface OpenCodeIncludeInput {
  kind: string;
  opencodeApiAvailable: boolean;
  hasSession: boolean;
  hasEventActivity: boolean;
}

export function shouldIncludeOpenCodeProcess(input: OpenCodeIncludeInput): boolean {
  if (input.kind === "opencode-server") return true;
  if (input.kind === "opencode-session") {
    return input.hasEventActivity;
  }
  if (input.kind === "opencode-tui" || input.kind === "opencode-cli") {
    return true;
  }
  if (input.opencodeApiAvailable) {
    return input.hasSession || input.hasEventActivity;
  }
  return input.hasEventActivity;
}
