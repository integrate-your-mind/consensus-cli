export type AgentState = "active" | "idle" | "error";
export type AgentKind =
  | "tui"
  | "exec"
  | "app-server"
  | "opencode-tui"
  | "opencode-cli"
  | "opencode-server"
  | "claude-tui"
  | "claude-cli"
  | "unknown";

export interface EventSummary {
  ts: number;
  type: string;
  summary: string;
  isError?: boolean;
}

export interface WorkSummary {
  current?: string;
  lastCommand?: string;
  lastEdit?: string;
  lastMessage?: string;
  lastTool?: string;
  lastPrompt?: string;
}

export interface AgentSnapshot {
  identity?: string;
  id: string;
  pid: number;
  startedAt?: number;
  lastEventAt?: number;
  lastActivityAt?: number;
  activityReason?: string;
  title?: string;
  cmd: string;
  cmdShort: string;
  kind: AgentKind;
  cpu: number;
  mem: number;
  state: AgentState;
  doing?: string;
  sessionPath?: string;
  repo?: string;
  cwd?: string;
  model?: string;
  summary?: WorkSummary;
  events?: EventSummary[];
}

export interface SnapshotMeta {
  pollMs?: number;
  opencode?: {
    ok: boolean;
    reachable?: boolean;
    status?: number;
    error?: string;
  };
  activity?: {
    counts?: Record<string, Record<AgentState, number>>;
    transitions?: Record<
      string,
      {
        total: number;
        byReason: Record<string, number>;
        byState: Record<string, number>;
      }
    >;
  };
}

export interface SnapshotPayload {
  ts: number;
  agents: AgentSnapshot[];
  meta?: SnapshotMeta;
}
