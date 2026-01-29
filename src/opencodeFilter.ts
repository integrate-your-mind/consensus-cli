export interface OpenCodeIncludeInput {
  kind: string;
  opencodeApiAvailable: boolean;
  hasSession: boolean;
  hasEventActivity: boolean;
  cpu: number;
  cpuThreshold: number;
}

export function shouldIncludeOpenCodeProcess(input: OpenCodeIncludeInput): boolean {
  if (input.kind === "opencode-server") return true;
  if (input.kind === "opencode-tui" || input.kind === "opencode-cli") return true;
  if (input.opencodeApiAvailable) {
    return input.hasSession || input.hasEventActivity;
  }
  if (input.hasEventActivity) return true;
  return input.cpu > input.cpuThreshold;
}
