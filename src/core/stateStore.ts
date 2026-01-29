import type { AgentState } from "../types.js";
import { baseAgentSnapshot, type AgentEvent, type AgentKey, type AgentMeta, type AgentRuntimeState, type SnapshotPayloadWithMeta } from "./events.js";

const DEFAULT_IDLE_HOLD_MS = 200;
const DEFAULT_STALE_SPAN_MS = 15000;

function nowMs(): number {
  return Date.now();
}

function resolveIdleHoldMs(): number {
  const raw = Number(process.env.CONSENSUS_IDLE_HOLD_MS || "");
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_IDLE_HOLD_MS;
}

function resolveStaleMs(): number {
  const raw = Number(process.env.CONSENSUS_SPAN_STALE_MS || "");
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_STALE_SPAN_MS;
}

function mergeMeta(target: AgentMeta, incoming?: AgentMeta): void {
  if (!incoming) return;
  Object.assign(target, incoming);
}

function updateLastEvent(state: AgentRuntimeState, ts: number): void {
  if (!Number.isFinite(ts)) return;
  state.lastEventAt = Math.max(state.lastEventAt || 0, ts);
  state.meta.lastEventAt = state.lastEventAt;
}

export class AgentStateStore {
  private states = new Map<AgentKey, AgentRuntimeState>();
  private listeners = new Set<(snapshot: SnapshotPayloadWithMeta) => void>();
  private pendingEmit = false;
  private lastSnapshot: SnapshotPayloadWithMeta = { ts: nowMs(), agents: [] };

  onSnapshot(listener: (snapshot: SnapshotPayloadWithMeta) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SnapshotPayloadWithMeta {
    return this.lastSnapshot;
  }

  ingest(event: AgentEvent): void {
    const state = this.ensureState(event.agent, event.t !== "presence.down");
    if (!state) return;

    mergeMeta(state.meta, event.meta);
    updateLastEvent(state, event.ts);

    switch (event.t) {
      case "presence.up":
        state.presenceUp = true;
        break;
      case "presence.down":
        state.presenceUp = false;
        state.blocked = false;
        state.spans.clear();
        this.clearTimers(state);
        this.states.delete(event.agent);
        this.queueEmit();
        return;
      case "blocked":
        state.blocked = true;
        state.spans.clear();
        this.scheduleIdle(state);
        break;
      case "unblocked":
        state.blocked = false;
        break;
      case "span.start": {
        state.spans.set(event.span, {
          kind: event.kind,
          startedAt: event.ts,
          lastProgressAt: event.ts,
        });
        this.clearIdle(state);
        this.resetStaleTimer(event.agent, state);
        break;
      }
      case "span.progress": {
        if (event.span && state.spans.has(event.span)) {
          const span = state.spans.get(event.span);
          if (span) span.lastProgressAt = event.ts;
        }
        if (state.spans.size > 0) {
          this.resetStaleTimer(event.agent, state);
        }
        break;
      }
      case "span.end": {
        state.spans.delete(event.span);
        if (state.spans.size === 0) {
          this.scheduleIdle(state);
          this.clearStale(state);
        }
        break;
      }
      default:
        break;
    }

    this.queueEmit();
  }

  private ensureState(agent: AgentKey, create: boolean): AgentRuntimeState | null {
    const existing = this.states.get(agent);
    if (existing) return existing;
    if (!create) return null;
    const state: AgentRuntimeState = {
      presenceUp: true,
      meta: {},
      spans: new Map(),
      blocked: false,
    };
    this.states.set(agent, state);
    return state;
  }

  private clearIdle(state: AgentRuntimeState): void {
    if (state.pendingIdleTimer) {
      clearTimeout(state.pendingIdleTimer);
      state.pendingIdleTimer = undefined;
    }
  }

  private clearStale(state: AgentRuntimeState): void {
    if (state.staleTimer) {
      clearTimeout(state.staleTimer);
      state.staleTimer = undefined;
    }
  }

  private clearTimers(state: AgentRuntimeState): void {
    this.clearIdle(state);
    this.clearStale(state);
  }

  private scheduleIdle(state: AgentRuntimeState): void {
    if (state.pendingIdleTimer) clearTimeout(state.pendingIdleTimer);
    const holdMs = resolveIdleHoldMs();
    state.pendingIdleTimer = setTimeout(() => {
      state.pendingIdleTimer = undefined;
      if (state.spans.size === 0 && !state.blocked) {
        this.queueEmit();
      }
    }, holdMs);
  }

  private resetStaleTimer(agent: AgentKey, state: AgentRuntimeState): void {
    if (state.staleTimer) clearTimeout(state.staleTimer);
    const staleMs = resolveStaleMs();
    state.staleTimer = setTimeout(() => {
      state.staleTimer = undefined;
      if (state.presenceUp && state.spans.size > 0) {
        state.spans.clear();
        this.queueEmit();
      }
    }, staleMs);
  }

  private queueEmit(): void {
    if (this.pendingEmit) return;
    this.pendingEmit = true;
    queueMicrotask(() => {
      this.pendingEmit = false;
      this.emitSnapshot();
    });
  }

  private emitSnapshot(): void {
    const agents: SnapshotPayloadWithMeta["agents"] = [];
    for (const [agent, state] of this.states.entries()) {
      if (!state.presenceUp) continue;
      const snapshot = baseAgentSnapshot(agent, state.meta);
      const active = state.presenceUp && !state.blocked && state.spans.size > 0;
      const hasError = !!state.meta.hasError;
      const nextState: AgentState = hasError ? "error" : active ? "active" : "idle";
      snapshot.state = nextState;
      if (state.lastEventAt) {
        snapshot.lastEventAt = state.lastEventAt;
      }
      agents.push(snapshot);
    }
    this.lastSnapshot = { ts: nowMs(), agents };
    for (const listener of this.listeners) {
      try {
        listener(this.lastSnapshot);
      } catch {
        // ignore listener errors
      }
    }
  }
}
