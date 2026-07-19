export type AgentState = 'active' | 'idle' | 'error';
export type CliType = 'codex' | 'opencode' | 'claude' | 'other';

export interface AgentSummary {
  current?: string;
  lastCommand?: string;
  lastEdit?: string;
  lastTool?: string;
  lastMessage?: string;
  lastPrompt?: string;
}

export interface AgentEvent {
  ts: number;
  type?: string;
  summary: string;
  isError?: boolean;
  turnId?: string | number;
}

export interface AgentSnapshot {
  identity: string;
  id: string;
  pid: number;
  cmd?: string;
  cmdShort?: string;
  kind: string;
  cpu: number;
  mem: number;
  state: AgentState;
  title?: string;
  repo?: string;
  cwd?: string;
  doing?: string;
  summary?: AgentSummary;
  events?: AgentEvent[];
  sessionPath?: string;
  model?: string;
  startedAt?: number;
  lastEventAt?: number;
  lastActivityAt?: number;
  activityReason?: string;
}

export interface ActivityCounts {
  active: number;
  idle: number;
  error: number;
}

export interface ActivityTransitionSummary {
  total: number;
  byReason: Record<string, number>;
  byState: Record<string, number>;
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
    counts?: Record<string, ActivityCounts>;
    transitions?: Record<string, ActivityTransitionSummary>;
    nextTickAt?: number;
  };
}

export interface SnapshotPayload {
  ts: number;
  agents: AgentSnapshot[];
  meta?: SnapshotMeta;
}

export interface TileColors {
  top: string;
  left: string;
  right: string;
  stroke: string;
}

export interface CliPalette {
  agent: Record<AgentState, TileColors>;
  server: Record<AgentState, TileColors>;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  glow: string;
}

export interface WsHelloMessage {
  v: 1;
  t: 'hello';
  protocol: 'json';
}

export interface WsWelcomeMessage {
  v: 1;
  t: 'welcome';
  seq: number;
}

export interface WsSnapshotMessage {
  v: 1;
  t: 'snapshot';
  seq: number;
  payload: SnapshotPayload;
}

export type DeltaOp =
  | { op: 'upsert'; id: string; value: AgentSnapshot }
  | { op: 'remove'; id: string }
  | { op: 'meta'; value: SnapshotMeta | null }
  | { op: 'ts'; value: number };

export interface WsDeltaMessage {
  v: 1;
  t: 'delta';
  seq: number;
  ops: DeltaOp[];
}

export interface WsPingMessage {
  v: 1;
  t: 'ping';
  seq: number;
}

export interface WsPongMessage {
  v: 1;
  t: 'pong';
  seq: number;
}

export type WsClientMessage = WsHelloMessage | WsPongMessage;
export type WsServerMessage =
  | WsWelcomeMessage
  | WsSnapshotMessage
  | WsDeltaMessage
  | WsPingMessage;
