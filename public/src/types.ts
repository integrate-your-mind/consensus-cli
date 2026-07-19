export type AgentState = 'active' | 'idle' | 'error';
export type CliType = 'codex' | 'opencode' | 'claude';

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
  summary: string;
}

export interface AgentSnapshot {
  identity?: string;
  id: string;
  pid?: number;
  sessionId?: string;
  parentSessionId?: string;
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
  active?: number;
  idle?: number;
  error?: number;
}

export interface ActivityTransitionSummary {
  total?: number;
  byReason?: Record<string, number>;
  byState?: Record<string, number>;
}

export interface SnapshotMeta {
  opencode?: {
    ok?: boolean;
    reachable?: boolean;
    error?: string;
    status?: number;
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

export type DeltaOp =
  | { op: 'upsert'; id: string; value: AgentSnapshot }
  | { op: 'remove'; id: string }
  | { op: 'meta'; value: SnapshotMeta | null }
  | { op: 'ts'; value: number };

export interface WsHelloMessage {
  v: 1;
  t: 'hello';
  role: 'viewer';
  enc: 'json';
  lastSeq?: number;
}

export interface WsWelcomeMessage {
  v: 1;
  t: 'welcome';
  enc: 'json';
  serverTime: number;
}

export interface WsSnapshotMessage {
  v: 1;
  t: 'snapshot';
  seq: number;
  data: SnapshotPayload;
}

export interface WsDeltaMessage {
  v: 1;
  t: 'delta';
  seq: number;
  ops: DeltaOp[];
}

export interface WsPingMessage {
  v: 1;
  t: 'ping';
}

export interface WsPongMessage {
  v: 1;
  t: 'pong';
  ts: number;
}

export type WsClientMessage = WsHelloMessage | WsPongMessage;
export type WsServerMessage = 
  | WsWelcomeMessage 
  | WsSnapshotMessage 
  | WsDeltaMessage 
  | WsPingMessage;

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

export type WsStatus = 'connecting' | 'live' | 'stale' | 'error' | 'disconnected';

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export interface Coordinate {
  x: number;
  y: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}
