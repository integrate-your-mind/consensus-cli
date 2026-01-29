import type { AgentStateStore } from "../core/stateStore.js";
import type { AgentMeta } from "../core/events.js";
import { onOpenCodeRawEvent } from "../opencodeEvents.js";

const TURN_SPAN = "turn";
const IDLE_DEBOUNCE_MS = 200;
const idleTimers = new Map<string, NodeJS.Timeout>();
const activeSessions = new Set<string>();

function parseTimestamp(value: any): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 100_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function getSessionId(raw: any): string | undefined {
  return (
    raw?.sessionId ||
    raw?.session_id ||
    raw?.session?.id ||
    raw?.session?.sessionId ||
    raw?.properties?.sessionId ||
    raw?.properties?.session_id
  );
}

function getType(raw: any): string {
  const typeRaw =
    raw?.type || raw?.event || raw?.name || raw?.kind || raw?.properties?.type || "";
  return typeof typeRaw === "string" ? typeRaw.toLowerCase() : "";
}

function getRole(raw: any): string {
  const roleRaw =
    raw?.role ||
    raw?.message?.role ||
    raw?.properties?.role ||
    raw?.message?.author?.role ||
    raw?.author?.role;
  return typeof roleRaw === "string" ? roleRaw.toLowerCase() : "";
}

function isAssistantMessage(raw: any): boolean {
  const role = getRole(raw);
  return role === "assistant" || role === "agent";
}

function resolveSessionMeta(raw: any): AgentMeta {
  const session = raw?.session || raw?.properties?.session || raw?.data?.session;
  const title = session?.title || session?.name || raw?.title || raw?.name;
  const cwd = session?.cwd || session?.directory || raw?.cwd || raw?.directory;
  const model = session?.model || raw?.model;
  const pid = session?.pid || raw?.pid;
  return {
    title: typeof title === "string" ? title : undefined,
    cwd: typeof cwd === "string" ? cwd : undefined,
    model: typeof model === "string" ? model : undefined,
    pid: typeof pid === "number" ? pid : undefined,
  };
}

export function attachOpenCodeActivity(store: AgentStateStore): () => void {
  const clearIdle = (agent: string) => {
    const timer = idleTimers.get(agent);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(agent);
    }
  };

  const scheduleIdle = (agent: string, ts: number, meta: AgentMeta) => {
    clearIdle(agent);
    const timer = setTimeout(() => {
      idleTimers.delete(agent);
      if (!activeSessions.has(agent)) return;
      store.ingest({ t: "span.end", agent, ts, span: TURN_SPAN, kind: "turn", meta });
      activeSessions.delete(agent);
    }, IDLE_DEBOUNCE_MS);
    idleTimers.set(agent, timer);
  };

  const startSpan = (agent: string, ts: number, meta: AgentMeta) => {
    clearIdle(agent);
    if (!activeSessions.has(agent)) {
      store.ingest({ t: "span.start", agent, ts, span: TURN_SPAN, kind: "turn", meta });
      activeSessions.add(agent);
    }
    store.ingest({ t: "span.progress", agent, ts, span: TURN_SPAN, kind: "turn", meta });
  };

  const listener = (raw: any) => {
    const sessionId = getSessionId(raw);
    if (!sessionId) return;
    const agent = `opencode:${sessionId}`;
    const type = getType(raw);
    const ts =
      parseTimestamp(
        raw?.ts ||
          raw?.timestamp ||
          raw?.time ||
          raw?.created_at ||
          raw?.createdAt ||
          raw?.properties?.time ||
          raw?.properties?.timestamp
      ) ?? Date.now();
    const meta = resolveSessionMeta(raw);
    meta.identity = agent;

    if (type === "session.created") {
      store.ingest({ t: "presence.up", agent, ts, meta });
      return;
    }
    if (type === "session.deleted") {
      store.ingest({ t: "presence.down", agent, ts, meta });
      activeSessions.delete(agent);
      clearIdle(agent);
      return;
    }
    if (type === "permission.asked") {
      store.ingest({ t: "blocked", agent, ts, meta });
      activeSessions.delete(agent);
      clearIdle(agent);
      return;
    }
    if (type === "permission.replied") {
      store.ingest({ t: "unblocked", agent, ts, meta });
      return;
    }
    const isTerminalEvent =
      /^(response|run)\.(completed|failed|errored|canceled|cancelled|aborted|interrupted|stopped)$/.test(
        type
      );
    if (isTerminalEvent) {
      store.ingest({ t: "span.end", agent, ts, span: TURN_SPAN, kind: "turn", meta });
      activeSessions.delete(agent);
      clearIdle(agent);
      return;
    }
    if (type === "session.idle") {
      scheduleIdle(agent, ts, meta);
      return;
    }
    if (
      type.startsWith("session.status") &&
      /idle|stopped|paused/.test(String(raw?.status || raw?.state || ""))
    ) {
      scheduleIdle(agent, ts, meta);
      return;
    }

    const isMessage = type.startsWith("message.");
    if (isMessage && !isAssistantMessage(raw)) {
      return;
    }

    const isAssistantPart = type === "message.part.updated" && isAssistantMessage(raw);
    const isDelta =
      /response\.((output_text|function_call_arguments|content_part|text)\.delta)$/.test(type);
    const isToolStart = type === "tool.execute.before";
    const isToolEnd = type === "tool.execute.after";

    if (isToolStart || isAssistantPart || isDelta) {
      startSpan(agent, ts, meta);
      return;
    }
    if (isToolEnd && activeSessions.has(agent)) {
      store.ingest({ t: "span.progress", agent, ts, span: TURN_SPAN, kind: "turn", meta });
    }
  };

  return onOpenCodeRawEvent(listener);
}
