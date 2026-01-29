import type { AgentKind, AgentSnapshot, AgentState, EventSummary, WorkSummary } from "../types.js";

export type AgentKey = string;
export type SpanKind = "turn" | "model_stream" | "tool" | "command" | "file_edit";

export type AgentMeta = Partial<Omit<AgentSnapshot, "state">> & {
  hasError?: boolean;
};

export type AgentEvent =
  | { t: "presence.up"; agent: AgentKey; ts: number; meta?: AgentMeta }
  | { t: "presence.down"; agent: AgentKey; ts: number; meta?: AgentMeta }
  | {
      t: "span.start";
      agent: AgentKey;
      ts: number;
      span: string;
      kind: SpanKind;
      meta?: AgentMeta;
    }
  | {
      t: "span.progress";
      agent: AgentKey;
      ts: number;
      span?: string;
      kind?: SpanKind;
      meta?: AgentMeta;
    }
  | {
      t: "span.end";
      agent: AgentKey;
      ts: number;
      span: string;
      kind?: SpanKind;
      meta?: AgentMeta;
    }
  | { t: "blocked"; agent: AgentKey; ts: number; reason?: string; meta?: AgentMeta }
  | { t: "unblocked"; agent: AgentKey; ts: number; meta?: AgentMeta };

export interface AgentRuntimeState {
  presenceUp: boolean;
  meta: AgentMeta;
  spans: Map<string, { kind: SpanKind; startedAt: number; lastProgressAt: number }>;
  blocked: boolean;
  lastEventAt?: number;
  pendingIdleTimer?: NodeJS.Timeout;
  staleTimer?: NodeJS.Timeout;
}

export interface SnapshotEmitter {
  onSnapshot(listener: (snapshot: SnapshotPayloadWithMeta) => void): () => void;
}

export interface SnapshotPayloadWithMeta {
  ts: number;
  agents: AgentSnapshot[];
  meta?: {
    pollMs?: number;
  };
}

export function baseAgentSnapshot(agent: AgentKey, meta: AgentMeta): AgentSnapshot {
  const id = meta.id ?? agent;
  const pid = typeof meta.pid === "number" ? meta.pid : -1;
  const cmd = meta.cmd ?? "";
  const cmdShort = meta.cmdShort ?? cmd;
  const kind = meta.kind ?? ("unknown" as AgentKind);
  const cpu = typeof meta.cpu === "number" ? meta.cpu : 0;
  const mem = typeof meta.mem === "number" ? meta.mem : 0;
  const snapshot: AgentSnapshot = {
    identity: meta.identity ?? agent,
    id,
    pid,
    cmd,
    cmdShort,
    kind,
    cpu,
    mem,
    state: "idle" as AgentState,
    startedAt: meta.startedAt,
    lastEventAt: meta.lastEventAt,
    title: meta.title,
    doing: meta.doing,
    sessionPath: meta.sessionPath,
    repo: meta.repo,
    cwd: meta.cwd,
    model: meta.model,
    summary: meta.summary as WorkSummary | undefined,
    events: meta.events as EventSummary[] | undefined,
  };
  return snapshot;
}
