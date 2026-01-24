export type AgentState = "active" | "idle" | "error";
export type AgentKind = "tui" | "exec" | "app-server" | "unknown";

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
  id: string;
  pid: number;
  startedAt?: number;
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

export interface SnapshotPayload {
  ts: number;
  agents: AgentSnapshot[];
}
