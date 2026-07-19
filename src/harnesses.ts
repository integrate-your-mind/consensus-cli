export const agentKinds = [
  "tui",
  "exec",
  "app-server",
  "opencode-tui",
  "opencode-cli",
  "opencode-server",
  "claude-tui",
  "claude-cli",
  "openclaw-cli",
  "openclaw-server",
  "hermes-cli",
  "hermes-server",
  "kimi-cli",
  "minimax-cli",
  "cursor-cli",
  "warp-cli",
  "factory-cli",
  "gemini-cli",
  "antigravity-cli",
  "qwen-cli",
  "copilot-cli",
  "aider-cli",
  "goose-cli",
  "amp-cli",
  "amazon-q-cli",
  "kiro-cli",
  "openhands-cli",
  "cline-ide",
  "roo-code-ide",
  "windsurf-ide",
  "junie-ide",
  "replit-agent",
  "zed-agent",
  "unknown",
] as const;

export type AgentKind = (typeof agentKinds)[number];

export const harnessIds = [
  "codex",
  "opencode",
  "claude",
  "openclaw",
  "hermes",
  "kimi",
  "minimax",
  "cursor",
  "warp",
  "factory",
  "gemini",
  "antigravity",
  "qwen",
  "copilot",
  "aider",
  "goose",
  "amp",
  "amazon-q",
  "kiro",
  "openhands",
  "cline",
  "roo-code",
  "windsurf",
  "junie",
  "replit",
  "zed",
  "other",
] as const;

export type HarnessId = (typeof harnessIds)[number];
export type HarnessClass =
  | "local-cli"
  | "local-server"
  | "ide-agent"
  | "remote-agent"
  | "tool-provider";
export type HarnessTelemetry =
  | "native-events"
  | "hooks"
  | "structured-stream"
  | "remote-api"
  | "process-only"
  | "tool-only"
  | "manual";

export interface HarnessProcessRule {
  binaries: readonly string[];
  kind: AgentKind;
  requiredAnyToken?: readonly string[];
}

export interface HarnessDefinition {
  id: HarnessId;
  displayName: string;
  kinds: readonly AgentKind[];
  class: HarnessClass;
  telemetry: HarnessTelemetry;
  docs?: string;
  processRules?: readonly HarnessProcessRule[];
  note?: string;
}

export const harnessDefinitions: readonly HarnessDefinition[] = [
  {
    id: "codex",
    displayName: "Codex",
    kinds: ["tui", "exec", "app-server"],
    class: "local-cli",
    telemetry: "native-events",
    docs: "https://developers.openai.com/codex/config-reference",
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    kinds: ["opencode-tui", "opencode-cli", "opencode-server"],
    class: "local-server",
    telemetry: "native-events",
    docs: "https://opencode.ai/docs/server/",
  },
  {
    id: "claude",
    displayName: "Claude Code",
    kinds: ["claude-tui", "claude-cli"],
    class: "local-cli",
    telemetry: "hooks",
    docs: "https://code.claude.com/docs/en/hooks",
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    kinds: ["openclaw-cli", "openclaw-server"],
    class: "local-server",
    telemetry: "native-events",
    docs: "https://docs.openclaw.ai/concepts/agent-loop",
    processRules: [
      {
        binaries: ["openclaw"],
        kind: "openclaw-server",
        requiredAnyToken: ["gateway", "serve", "server", "daemon"],
      },
      { binaries: ["openclaw"], kind: "openclaw-cli" },
    ],
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    kinds: ["hermes-cli", "hermes-server"],
    class: "local-cli",
    telemetry: "hooks",
    docs: "https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/",
    processRules: [
      {
        binaries: ["hermes"],
        kind: "hermes-server",
        requiredAnyToken: ["gateway", "serve", "server", "daemon"],
      },
      { binaries: ["hermes"], kind: "hermes-cli" },
    ],
  },
  {
    id: "kimi",
    displayName: "Kimi Code",
    kinds: ["kimi-cli"],
    class: "local-cli",
    telemetry: "hooks",
    docs: "https://moonshotai.github.io/kimi-code/en/customization/hooks",
    processRules: [
      { binaries: ["kimi", "kimi-code", "kimi-cli"], kind: "kimi-cli" },
    ],
  },
  {
    id: "minimax",
    displayName: "MiniMax CLI",
    kinds: ["minimax-cli"],
    class: "tool-provider",
    telemetry: "tool-only",
    docs: "https://platform.minimax.io/docs/token-plan/minimax-cli",
    processRules: [
      { binaries: ["mmx", "mmx-cli", "minimax-cli"], kind: "minimax-cli" },
    ],
    note:
      "MiniMax CLI is currently modeled as a tool/model integration, not a full coding-agent runtime.",
  },
  {
    id: "cursor",
    displayName: "Cursor Agent",
    kinds: ["cursor-cli"],
    class: "local-cli",
    telemetry: "structured-stream",
    docs: "https://docs.cursor.com/en/cli/using",
    processRules: [{ binaries: ["cursor-agent"], kind: "cursor-cli" }],
    note:
      "Cursor CLI exposes structured stream output and a partial hook set; coverage must state which source was observed.",
  },
  {
    id: "warp",
    displayName: "Warp Oz",
    kinds: ["warp-cli"],
    class: "remote-agent",
    telemetry: "remote-api",
    docs: "https://docs.warp.dev/reference/cli",
    processRules: [
      {
        binaries: ["oz", "oz-preview"],
        kind: "warp-cli",
        requiredAnyToken: ["agent"],
      },
    ],
  },
  {
    id: "factory",
    displayName: "Factory Droid",
    kinds: ["factory-cli"],
    class: "local-cli",
    telemetry: "hooks",
    docs: "https://docs.factory.ai/reference/hooks-reference",
    processRules: [{ binaries: ["droid"], kind: "factory-cli" }],
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    kinds: ["gemini-cli"],
    class: "local-cli",
    telemetry: "hooks",
    docs: "https://geminicli.com/docs/hooks/",
    processRules: [{ binaries: ["gemini"], kind: "gemini-cli" }],
  },
  {
    id: "antigravity",
    displayName: "Antigravity CLI",
    kinds: ["antigravity-cli"],
    class: "local-cli",
    telemetry: "process-only",
    processRules: [
      { binaries: ["antigravity", "antigravity-cli"], kind: "antigravity-cli" },
    ],
  },
  {
    id: "qwen",
    displayName: "Qwen Code",
    kinds: ["qwen-cli"],
    class: "local-cli",
    telemetry: "hooks",
    docs: "https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/",
    processRules: [{ binaries: ["qwen", "qwen-code"], kind: "qwen-cli" }],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    kinds: ["copilot-cli"],
    class: "local-cli",
    telemetry: "hooks",
    docs: "https://docs.github.com/en/copilot/reference/hooks-reference",
    processRules: [{ binaries: ["copilot"], kind: "copilot-cli" }],
  },
  {
    id: "aider",
    displayName: "Aider",
    kinds: ["aider-cli"],
    class: "local-cli",
    telemetry: "process-only",
    processRules: [{ binaries: ["aider"], kind: "aider-cli" }],
  },
  {
    id: "goose",
    displayName: "Goose",
    kinds: ["goose-cli"],
    class: "local-cli",
    telemetry: "process-only",
    processRules: [{ binaries: ["goose"], kind: "goose-cli" }],
  },
  {
    id: "amp",
    displayName: "Amp",
    kinds: ["amp-cli"],
    class: "local-cli",
    telemetry: "process-only",
    processRules: [{ binaries: ["amp"], kind: "amp-cli" }],
  },
  {
    id: "amazon-q",
    displayName: "Amazon Q Developer",
    kinds: ["amazon-q-cli"],
    class: "local-cli",
    telemetry: "process-only",
    processRules: [
      {
        binaries: ["q"],
        kind: "amazon-q-cli",
        requiredAnyToken: ["chat", "agent"],
      },
    ],
  },
  {
    id: "kiro",
    displayName: "Kiro",
    kinds: ["kiro-cli"],
    class: "local-cli",
    telemetry: "process-only",
    processRules: [{ binaries: ["kiro", "kiro-cli"], kind: "kiro-cli" }],
  },
  {
    id: "openhands",
    displayName: "OpenHands",
    kinds: ["openhands-cli"],
    class: "local-cli",
    telemetry: "process-only",
    processRules: [
      { binaries: ["openhands", "openhands-cli"], kind: "openhands-cli" },
    ],
  },
  {
    id: "cline",
    displayName: "Cline",
    kinds: ["cline-ide"],
    class: "ide-agent",
    telemetry: "manual",
  },
  {
    id: "roo-code",
    displayName: "Roo Code",
    kinds: ["roo-code-ide"],
    class: "ide-agent",
    telemetry: "manual",
  },
  {
    id: "windsurf",
    displayName: "Windsurf Cascade",
    kinds: ["windsurf-ide"],
    class: "ide-agent",
    telemetry: "manual",
  },
  {
    id: "junie",
    displayName: "JetBrains Junie",
    kinds: ["junie-ide"],
    class: "ide-agent",
    telemetry: "manual",
  },
  {
    id: "replit",
    displayName: "Replit Agent",
    kinds: ["replit-agent"],
    class: "remote-agent",
    telemetry: "remote-api",
  },
  {
    id: "zed",
    displayName: "Zed Agent",
    kinds: ["zed-agent"],
    class: "ide-agent",
    telemetry: "manual",
  },
  {
    id: "other",
    displayName: "Other agent",
    kinds: ["unknown"],
    class: "local-cli",
    telemetry: "process-only",
  },
] as const;

const agentKindSet = new Set<string>(agentKinds);
const harnessById = new Map(
  harnessDefinitions.map((definition) => [definition.id, definition])
);
const harnessByKind = new Map<AgentKind, HarnessDefinition>();
for (const definition of harnessDefinitions) {
  for (const kind of definition.kinds) harnessByKind.set(kind, definition);
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function basename(value: string): string {
  const parts = stripQuotes(value).split(/[\\/]/);
  return (parts[parts.length - 1] || value)
    .toLowerCase()
    .replace(/\.exe$/, "");
}

function commandTokens(command: string | undefined): string[] {
  if (!command) return [];
  return (
    command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(stripQuotes) ?? []
  );
}

function ruleMatches(
  rule: HarnessProcessRule,
  command: string | undefined,
  processName: string | undefined
): boolean {
  const tokens = commandTokens(command);
  const executable = tokens[0] ? basename(tokens[0]) : undefined;
  const name = processName ? basename(processName) : undefined;
  const binaries = new Set(
    rule.binaries.map((binary) => binary.toLowerCase().replace(/\.exe$/, ""))
  );
  if (!((executable && binaries.has(executable)) || (name && binaries.has(name)))) {
    return false;
  }
  if (!rule.requiredAnyToken?.length) return true;
  const commandTokensLower = new Set(
    tokens.slice(1).map((token) => token.toLowerCase())
  );
  return rule.requiredAnyToken.some((token) =>
    commandTokensLower.has(token.toLowerCase())
  );
}

export interface DetectedHarnessProcess {
  harness: HarnessDefinition;
  kind: AgentKind;
}

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && agentKindSet.has(value);
}

export function harnessForId(id: HarnessId): HarnessDefinition {
  return harnessById.get(id) ?? harnessById.get("other")!;
}

export function harnessForKind(kind: AgentKind): HarnessDefinition {
  return harnessByKind.get(kind) ?? harnessById.get("other")!;
}

export function harnessIdForKind(kind: AgentKind): HarnessId {
  return harnessForKind(kind).id;
}

export function detectGenericHarnessProcess(
  command: string | undefined,
  processName: string | undefined
): DetectedHarnessProcess | undefined {
  for (const harness of harnessDefinitions) {
    if (
      harness.id === "codex" ||
      harness.id === "opencode" ||
      harness.id === "claude"
    ) {
      continue;
    }
    for (const rule of harness.processRules ?? []) {
      if (ruleMatches(rule, command, processName)) {
        return { harness, kind: rule.kind };
      }
    }
  }
  return undefined;
}

export function harnessCoverageNote(
  harness: HarnessDefinition,
  hasEvents: boolean
): string | undefined {
  if (hasEvents) return undefined;
  if (harness.note) return harness.note;
  if (harness.telemetry === "hooks") {
    return `${harness.displayName} was detected, but no retained hook events were available.`;
  }
  if (harness.telemetry === "native-events") {
    return `${harness.displayName} was detected, but no native runtime events were retained.`;
  }
  if (harness.telemetry === "structured-stream") {
    return `${harness.displayName} was detected, but no structured stream was attached to this snapshot.`;
  }
  if (harness.telemetry === "remote-api") {
    return `${harness.displayName} was detected locally; remote run history requires an explicit API adapter.`;
  }
  if (harness.telemetry === "tool-only") {
    return `${harness.displayName} is a tool/model integration rather than a complete observed agent loop.`;
  }
  if (harness.telemetry === "manual") {
    return `${harness.displayName} requires an IDE or extension adapter; process detection alone is not reliable.`;
  }
  return `${harness.displayName} currently has process-level coverage only.`;
}
