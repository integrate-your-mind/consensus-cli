import path from "node:path";

export type LifecycleEventKind =
  | "agent_start"
  | "agent_stop"
  | "tool_start"
  | "tool_end"
  | "approval_wait"
  | "approval_resolved";

export type ToolKey = string;

export type ThreadLifecycleSummary = {
  lastTool?: string;
  lastCommand?: string;
  lastMessage?: string;
  lastPrompt?: string;
};

export interface ThreadLifecycleState {
  readonly threadId: string;
  turnOpen: boolean;
  reviewMode: boolean;
  awaitingApproval: boolean;
  pendingEndAt?: number;
  lastEndAt?: number;
  lastActivityAt?: number;
  lastSignalAt?: number;
  openToolIds: Set<ToolKey>;
  openAnonTools: number;
  lastSummary?: ThreadLifecycleSummary;
  lastUpdatedAt: number;
}

export type ThreadLifecycleSnapshot = {
  threadId: string;
  inFlight: boolean;
  openCallCount: number;
  lastActivityAt?: number;
  reason: string;
  endedAt?: number;
};

function resolveMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a !== "number") return typeof b === "number" ? b : undefined;
  if (typeof b !== "number") return a;
  return Math.max(a, b);
}

function noteRecent(set: Set<string>, id: string, cap: number, state: ThreadLifecycleState): void {
  if (set.has(id)) {
    // Refresh insertion order.
    set.delete(id);
    set.add(id);
    return;
  }
  set.add(id);
  if (set.size <= cap) return;
  const overflow = set.size - cap;
  let removed = 0;
  for (const existing of set) {
    set.delete(existing);
    removed += 1;
    if (removed >= overflow) break;
  }
  if (removed > 0) state.openAnonTools += removed;
}

export class CodexLifecycleGraph {
  private threads = new Map<string, ThreadLifecycleState>();
  private threadIdByPath = new Map<string, string>();
  private pathsByThreadId = new Map<string, Set<string>>();

  ensureThread(threadId: string, nowMs: number = Date.now()): ThreadLifecycleState {
    const existing = this.threads.get(threadId);
    if (existing) return existing;
    const created: ThreadLifecycleState = {
      threadId,
      turnOpen: false,
      reviewMode: false,
      awaitingApproval: false,
      openToolIds: new Set(),
      openAnonTools: 0,
      lastUpdatedAt: nowMs,
    };
    this.threads.set(threadId, created);
    return created;
  }

  linkPath(sessionPath: string, threadId: string): void {
    if (!sessionPath) return;
    const resolved = path.resolve(sessionPath);
    const existing = this.threadIdByPath.get(resolved);
    if (existing && existing !== threadId) {
      const paths = this.pathsByThreadId.get(existing);
      if (paths) {
        paths.delete(resolved);
        if (paths.size === 0) this.pathsByThreadId.delete(existing);
      }
    }
    this.threadIdByPath.set(resolved, threadId);
    const bucket = this.pathsByThreadId.get(threadId) ?? new Set<string>();
    bucket.add(resolved);
    this.pathsByThreadId.set(threadId, bucket);
  }

  resolveThreadId(sessionPath: string): string | undefined {
    return this.threadIdByPath.get(path.resolve(sessionPath));
  }

  ingestFileSignal(threadId: string, signalAt: number, nowMs: number = Date.now()): void {
    const state = this.ensureThread(threadId, nowMs);
    state.lastSignalAt = Math.max(state.lastSignalAt || 0, signalAt);
    state.lastUpdatedAt = nowMs;
  }

  ingestSummary(
    threadId: string,
    update: Partial<ThreadLifecycleSummary>,
    nowMs: number = Date.now()
  ): void {
    const state = this.ensureThread(threadId, nowMs);
    state.lastSummary = { ...(state.lastSummary ?? {}), ...update };
    state.lastUpdatedAt = nowMs;
  }

  ingestActivity(threadId: string, ts: number, nowMs: number = Date.now()): void {
    const state = this.ensureThread(threadId, nowMs);
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  ingestAgentStart(threadId: string, ts: number, nowMs: number = Date.now()): void {
    const state = this.ensureThread(threadId, nowMs);
    state.turnOpen = true;
    state.pendingEndAt = undefined;
    state.lastEndAt = undefined;
    state.awaitingApproval = false;
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  ingestAgentStop(threadId: string, ts: number, nowMs: number = Date.now()): void {
    const state = this.ensureThread(threadId, nowMs);
    state.pendingEndAt = Math.max(state.pendingEndAt || 0, ts);
    state.turnOpen = false;
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  ingestNotifyEnd(threadId: string, ts: number, nowMs: number = Date.now()): void {
    this.ingestAgentStop(threadId, ts, nowMs);
  }

  ingestReviewMode(threadId: string, enabled: boolean, ts: number, nowMs: number = Date.now()): void {
    const state = this.ensureThread(threadId, nowMs);
    state.reviewMode = enabled;
    if (enabled) {
      state.turnOpen = true;
      state.pendingEndAt = undefined;
      state.lastEndAt = undefined;
    } else {
      state.pendingEndAt = Math.max(state.pendingEndAt || 0, ts);
      state.turnOpen = false;
    }
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  ingestApprovalWait(threadId: string, ts: number, nowMs: number = Date.now()): void {
    const state = this.ensureThread(threadId, nowMs);
    state.awaitingApproval = true;
    state.turnOpen = true;
    state.pendingEndAt = undefined;
    state.lastEndAt = undefined;
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  ingestApprovalResolved(threadId: string, ts: number, nowMs: number = Date.now()): void {
    const state = this.ensureThread(threadId, nowMs);
    state.awaitingApproval = false;
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  ingestToolStart(
    threadId: string,
    toolId: string | undefined,
    ts: number,
    nowMs: number = Date.now()
  ): void {
    const state = this.ensureThread(threadId, nowMs);
    if (toolId) {
      noteRecent(state.openToolIds, toolId, 500, state);
    } else {
      state.openAnonTools += 1;
    }
    state.turnOpen = true;
    state.pendingEndAt = undefined;
    state.lastEndAt = undefined;
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  ingestToolEnd(
    threadId: string,
    toolId: string | undefined,
    ts: number,
    nowMs: number = Date.now()
  ): void {
    const state = this.ensureThread(threadId, nowMs);
    if (toolId) {
      if (state.openToolIds.delete(toolId)) {
        // ok
      } else if (state.openAnonTools > 0) {
        // Best-effort: end may correspond to an overflowed tool id.
        state.openAnonTools -= 1;
      }
    } else if (state.openAnonTools > 0) {
      state.openAnonTools -= 1;
    } else if (state.openToolIds.size > 0) {
      // Best-effort: some tool output events omit identifiers; close one open tool.
      const first = state.openToolIds.values().next().value;
      if (typeof first === "string") {
        state.openToolIds.delete(first);
      }
    }
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    state.lastUpdatedAt = nowMs;
  }

  resetThread(threadId: string): void {
    this.dropThread(threadId);
  }

  getThreadSnapshot(threadId: string, nowMs: number = Date.now()): ThreadLifecycleSnapshot | null {
    const state = this.threads.get(threadId);
    if (!state) return null;

    const inFlightTimeoutMs = resolveMs(
      process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS,
      2500
    );
    const staleFileMs = resolveMs(process.env.CONSENSUS_CODEX_STALE_FILE_MS, 120000);
    const graceMs = resolveMs(process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS, 0);

    const lastSignalAt = state.lastSignalAt ?? state.lastActivityAt;
    const signalStale =
      typeof lastSignalAt === "number" &&
      Number.isFinite(inFlightTimeoutMs) &&
      inFlightTimeoutMs > 0 &&
      nowMs - lastSignalAt >= inFlightTimeoutMs;
    const staleAnchor =
      state.lastSignalAt ?? state.lastActivityAt ?? state.lastUpdatedAt;
    const staleFile =
      typeof staleAnchor === "number" &&
      Number.isFinite(staleFileMs) &&
      staleFileMs > 0 &&
      nowMs - staleAnchor > staleFileMs;
    if (staleFile) {
      this.dropThread(threadId);
      return {
        threadId,
        inFlight: false,
        openCallCount: 0,
        lastActivityAt: undefined,
        reason: "stale_timeout",
      };
    }

    const openCallCount = (state.openToolIds?.size ?? 0) + (state.openAnonTools ?? 0);
    const lastActivityAt = maxDefined(state.lastActivityAt, state.lastSignalAt);

    const pendingEndAt = state.pendingEndAt;
    const pendingActive =
      typeof pendingEndAt === "number" &&
      openCallCount === 0 &&
      !state.reviewMode &&
      !state.awaitingApproval;

    const lastSignalForFinalize = maxDefined(state.lastSignalAt, state.lastActivityAt) ?? 0;
    const canFinalize =
      typeof pendingEndAt === "number" &&
      pendingActive &&
      (nowMs - pendingEndAt >= graceMs) &&
      lastSignalForFinalize <= pendingEndAt;

    const endedAt = canFinalize ? pendingEndAt : undefined;

    if (canFinalize) {
      state.lastEndAt = pendingEndAt;
    }

    const inFlight =
      state.awaitingApproval ||
      state.reviewMode ||
      openCallCount > 0 ||
      (!signalStale && !canFinalize && !!state.turnOpen) ||
      (!signalStale && !canFinalize && typeof pendingEndAt === "number");

    const reason = (() => {
      if (canFinalize) return "ended";
      if (signalStale && !state.awaitingApproval && !state.reviewMode && openCallCount === 0) {
        return "stale_timeout";
      }
      if (state.awaitingApproval) return "approval";
      if (state.reviewMode) return "review";
      if (openCallCount > 0) return "tool_open";
      if (!canFinalize && typeof pendingEndAt === "number") return "pending_end";
      if (!canFinalize && state.turnOpen) return "turn_open";
      return "idle";
    })();

    return {
      threadId,
      inFlight,
      openCallCount,
      lastActivityAt,
      reason,
      endedAt,
    };
  }

  private dropThread(threadId: string): void {
    this.threads.delete(threadId);
    const paths = this.pathsByThreadId.get(threadId);
    if (!paths) return;
    for (const resolved of paths) {
      this.threadIdByPath.delete(resolved);
    }
    this.pathsByThreadId.delete(threadId);
  }
}

export const codexLifecycleGraph = new CodexLifecycleGraph();
