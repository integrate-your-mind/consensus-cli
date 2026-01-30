import type { EventSummary, WorkSummary } from "./types.js";
import { createParser } from "eventsource-parser";
import { redactText } from "./redact.js";

const MAX_EVENTS = 50;
const STALE_TTL_MS = 30 * 60 * 1000;
const RECONNECT_MIN_MS = 10_000;
const isDebugActivity = () => process.env.CONSENSUS_DEBUG_ACTIVITY === "1";
const INFLIGHT_TIMEOUT_MS = Number(
  process.env.CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS || 15000
);
const ACTIVITY_KINDS = new Set<string>(["command", "edit", "message", "prompt", "tool"]);
// Meta events that don't indicate real activity
const META_EVENT_RE =
  /^(server\.(connected|disconnected|instance)|installation\.|snapshot|history|heartbeat|connected|ready|ping|pong)(\.|$)/i;
// Events that start in-flight activity
const START_EVENT_RE =
  /(tool\.execute\.before|response\.(started|in_progress|running)|run\.(started|in_progress|running)|session\.status)/i;
// Events that end in-flight activity
const END_EVENT_RE =
  /((response|run)\.(completed|failed|errored|canceled|cancelled|aborted|interrupted|stopped)|session\.idle)/i;
// Delta/streaming events that indicate ongoing activity
const DELTA_EVENT_RE =
  /(response\.((output_text|function_call_arguments|content_part|text)\.delta)|message\.part\.updated)/i;
// OpenCode session status values that indicate busy
const BUSY_STATUS_RE = /^(busy|running|generating|processing)$/i;

interface ActivityState {
  events: EventSummary[];
  summary: WorkSummary;
  lastEventAt?: number;
  lastActivityAt?: number;
  lastInFlightSignalAt?: number;
  lastStatus?: string;
  lastStatusAt?: number;
  lastCommand?: EventSummary;
  lastEdit?: EventSummary;
  lastMessage?: EventSummary;
  lastTool?: EventSummary;
  lastPrompt?: EventSummary;
  lastError?: EventSummary;
  inFlight?: boolean;
  lastSeenAt: number;
}

const sessionActivity = new Map<string, ActivityState>();
const pidActivity = new Map<number, ActivityState>();

type OpenCodeEventListener = () => void;
const listeners = new Set<OpenCodeEventListener>();

export function onOpenCodeEvent(listener: OpenCodeEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type OpenCodeRawListener = (raw: any) => void;
const rawListeners = new Set<OpenCodeRawListener>();

export function onOpenCodeRawEvent(listener: OpenCodeRawListener): () => void {
  rawListeners.add(listener);
  return () => rawListeners.delete(listener);
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

function notifyRawListeners(raw: any): void {
  for (const listener of rawListeners) {
    try {
      listener(raw);
    } catch {
      // Ignore listener errors
    }
  }
}

function logDebug(message: string): void {
  if (!isDebugActivity()) return;
  process.stderr.write(`[consensus][opencode] ${message}\n`);
}

function expireInFlight(state: ActivityState, now: number): void {
  if (!state.inFlight) return;
  if (typeof state.lastStatusAt === "number") return;
  const lastSignal = state.lastInFlightSignalAt ?? state.lastActivityAt ?? state.lastEventAt;
  if (typeof lastSignal === "number" && now - lastSignal > INFLIGHT_TIMEOUT_MS) {
    state.inFlight = false;
    state.lastInFlightSignalAt = undefined;
    state.lastActivityAt = undefined;
  }
}

let connecting = false;
let connected = false;
let lastConnectAt = 0;
let lastFailureAt = 0;
let activeAbort: AbortController | null = null;

function nowMs(): number {
  return Date.now();
}

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

function extractText(value: any): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.message === "string") return value.message;
    if (value.message && typeof value.message.content === "string") {
      return value.message.content;
    }
  }
  return undefined;
}

function getSessionId(raw: any): string | undefined {
  // Direct session ID fields
  if (raw?.sessionId) return raw.sessionId;
  if (raw?.session_id) return raw.session_id;
  if (raw?.sessionID) return raw.sessionID;
  
  // Nested in session object
  if (raw?.session?.id) return raw.session.id;
  if (raw?.session?.sessionId) return raw.session.sessionId;
  if (raw?.session?.sessionID) return raw.session.sessionID;
  if (raw?.session?.session_id) return raw.session.session_id;
  
  // OpenCode event format: properties.sessionID (for session.status, session.idle, etc.)
  if (raw?.properties?.sessionID) return raw.properties.sessionID;
  if (raw?.properties?.sessionId) return raw.properties.sessionId;
  if (raw?.properties?.session_id) return raw.properties.session_id;
  
  // OpenCode event format: properties.session.id
  if (raw?.properties?.session?.id) return raw.properties.session.id;
  if (raw?.properties?.session?.sessionId) return raw.properties.session.sessionId;
  if (raw?.properties?.session?.sessionID) return raw.properties.session.sessionID;
  if (raw?.properties?.session?.session_id) return raw.properties.session.session_id;
  
  // OpenCode event format: properties.part.sessionID (for message.part.updated)
  if (raw?.properties?.part?.sessionID) return raw.properties.part.sessionID;
  if (raw?.properties?.part?.sessionId) return raw.properties.part.sessionId;
  if (raw?.properties?.part?.session_id) return raw.properties.part.session_id;
  
  // OpenCode event format: properties.info.id (for session.created/updated)
  if (raw?.properties?.info?.id) return raw.properties.info.id;
  
  // Message events: properties.info.sessionID
  if (raw?.properties?.info?.sessionID) return raw.properties.info.sessionID;
  if (raw?.properties?.info?.sessionId) return raw.properties.info.sessionId;
  if (raw?.properties?.info?.session_id) return raw.properties.info.session_id;
  
  return undefined;
}

function getPid(raw: any): number | undefined {
  const pid =
    raw?.pid ||
    raw?.process?.pid ||
    raw?.properties?.pid ||
    raw?.properties?.processId ||
    raw?.properties?.session?.pid ||
    raw?.properties?.session?.processId;
  if (typeof pid === "number" && Number.isFinite(pid)) return pid;
  if (typeof pid === "string") {
    const parsed = Number(pid);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function summarizeEvent(raw: any): {
  summary?: string;
  kind?: "command" | "edit" | "message" | "prompt" | "tool" | "other";
  isError?: boolean;
  type?: string;
  inFlight?: boolean;
  status?: string;
} {
  const typeRaw =
    raw?.type ||
    raw?.event ||
    raw?.name ||
    raw?.kind ||
    raw?.properties?.type ||
    "event";
  const type = typeof typeRaw === "string" ? typeRaw : "event";
  const lowerType = type.toLowerCase();
  const normalizedType = lowerType.startsWith("tui.")
    ? lowerType.slice(4)
    : lowerType;
  const statusRaw = raw?.status || raw?.state || raw?.properties?.status;
  const statusStr = typeof statusRaw === "string" ? statusRaw.toLowerCase() : "";
  const isError =
    !!raw?.error || lowerType.includes("error") || statusStr.includes("error");
  let inFlight: boolean | undefined;
  const isMessagePartUpdated = /message\.part\.updated/i.test(normalizedType);
  const partRole =
    raw?.role ||
    raw?.message?.role ||
    raw?.part?.role ||
    raw?.properties?.role;
  const partType =
    raw?.part?.type || raw?.part?.content?.type || raw?.properties?.partType;
  const shouldTreatMessagePartActive =
    isMessagePartUpdated &&
    (partRole === "assistant" ||
      partRole === "assistant_response" ||
      partType === "output_text" ||
      partType === "text");
  // Handle session.status event with status property
  const sessionStatus = raw?.properties?.status?.type || raw?.properties?.status;
  const sessionStatusStr = typeof sessionStatus === "string" ? sessionStatus : "";
  const status =
    normalizedType === "session.status"
      ? sessionStatusStr
      : normalizedType === "session.idle"
        ? "idle"
        : undefined;
  
  if (normalizedType === "session.status") {
    // session.status event: check if status is "busy" for in-flight
    if (BUSY_STATUS_RE.test(sessionStatusStr)) {
      inFlight = true;
    } else {
      inFlight = false;
    }
  } else if (normalizedType === "session.idle") {
    inFlight = false;
  } else if (START_EVENT_RE.test(normalizedType) || DELTA_EVENT_RE.test(normalizedType)) {
    if (!isMessagePartUpdated || shouldTreatMessagePartActive) {
      inFlight = true;
    }
  } else if (END_EVENT_RE.test(normalizedType) || isError) {
    inFlight = false;
  }

  if (normalizedType.includes("compaction")) {
    const phase = statusStr || raw?.phase || raw?.properties?.phase;
    const summary = phase ? `compaction: ${phase}` : "compaction";
    return { summary, kind: "other", isError, type, inFlight, status };
  }

  const cmd =
    raw?.command ||
    raw?.cmd ||
    raw?.input?.command ||
    raw?.input?.cmd ||
    raw?.properties?.command ||
    raw?.properties?.cmd ||
    (Array.isArray(raw?.args) ? raw.args.join(" ") : undefined);
  if (typeof cmd === "string" && cmd.trim()) {
    const summary = redactText(`cmd: ${cmd.trim()}`) || `cmd: ${cmd.trim()}`;
    return { summary, kind: "command", isError, type, inFlight, status };
  }

  const pathHint =
    raw?.path ||
    raw?.file ||
    raw?.filename ||
    raw?.target ||
    raw?.properties?.path ||
    raw?.properties?.file;
  if (typeof pathHint === "string" && pathHint.trim() && normalizedType.includes("file")) {
    const summary = redactText(`edit: ${pathHint.trim()}`) || `edit: ${pathHint.trim()}`;
    return { summary, kind: "edit", isError, type, inFlight, status };
  }

  const tool =
    raw?.tool ||
    raw?.tool_name ||
    raw?.toolName ||
    raw?.properties?.tool ||
    raw?.properties?.tool_name;
  if (typeof tool === "string" && tool.trim() && lowerType.includes("tool")) {
    const summary = redactText(`tool: ${tool.trim()}`) || `tool: ${tool.trim()}`;
    return { summary, kind: "tool", isError, type, inFlight, status };
  }

  const promptText =
    extractText(raw?.prompt) ||
    extractText(raw?.input) ||
    extractText(raw?.instruction) ||
    extractText(raw?.properties?.prompt);
  if (promptText && normalizedType.includes("prompt")) {
    const trimmed = promptText.replace(/\s+/g, " ").trim();
    const snippet = trimmed.slice(0, 120);
    const summary = redactText(`prompt: ${snippet}`) || `prompt: ${snippet}`;
    return { summary, kind: "prompt", isError, type, inFlight, status };
  }

  const roleRaw =
    raw?.role ||
    raw?.message?.role ||
    raw?.properties?.role ||
    raw?.message?.author?.role ||
    raw?.author?.role;
  const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "";
  if (isMessagePartUpdated) {
    if (role === "assistant" || role === "agent") {
      inFlight = true;
    } else {
      inFlight = undefined;
    }
  }
  const messageText =
    extractText(raw?.message) ||
    extractText(raw?.content) ||
    extractText(raw?.text) ||
    extractText(raw?.properties?.message);
  if (messageText) {
    const trimmed = messageText.replace(/\s+/g, " ").trim();
    const snippet = trimmed.slice(0, 80);
    if (role === "assistant" || role === "agent") {
      const summary = redactText(snippet) || snippet;
      return {
        summary,
        kind: "message",
        isError,
        type,
        inFlight: isMessagePartUpdated ? true : undefined,
        status,
      };
    }
    if (role === "user") {
      const summary = redactText(`prompt: ${snippet}`) || `prompt: ${snippet}`;
      return { summary, kind: "prompt", isError, type, inFlight, status };
    }
  }

  if (type && type !== "event") {
    const summary = redactText(`event: ${type}`) || `event: ${type}`;
    return { summary, kind: "other", isError, type, inFlight, status };
  }

  return { kind: "other", isError, type, inFlight, status };
}

function isActivityEvent(input: {
  kind?: string;
  type?: string;
  inFlight?: boolean;
}): boolean {
  const type = typeof input.type === "string" ? input.type : "";
  const lowerType = type.toLowerCase();
  const normalizedType = lowerType.startsWith("tui.")
    ? lowerType.slice(4)
    : lowerType;
  if (META_EVENT_RE.test(normalizedType)) return false;
  if (input.inFlight) return true;
  if (input.kind && ACTIVITY_KINDS.has(input.kind)) return true;
  if (lowerType.startsWith("tui.")) return true;
  if (START_EVENT_RE.test(normalizedType) || DELTA_EVENT_RE.test(normalizedType))
    return true;
  return false;
}

function ensureActivity<T extends string | number>(
  key: T,
  map: Map<T, ActivityState>,
  now: number
): ActivityState {
  const existing = map.get(key);
  if (existing) {
    existing.lastSeenAt = now;
    return existing;
  }
  const fresh: ActivityState = {
    events: [],
    summary: {},
    lastSeenAt: now,
  };
  map.set(key, fresh);
  return fresh;
}

function recordEvent(
  state: ActivityState,
  entry: EventSummary,
  kind: string | undefined,
  activityTs?: number
): void {
  state.events.push(entry);
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
  state.lastEventAt = Math.max(state.lastEventAt || 0, entry.ts);
  if (kind === "command") state.lastCommand = entry;
  if (kind === "edit") state.lastEdit = entry;
  if (kind === "message") state.lastMessage = entry;
  if (kind === "tool") state.lastTool = entry;
  if (kind === "prompt") state.lastPrompt = entry;
  if (entry.isError) state.lastError = entry;
  if (typeof activityTs === "number") {
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, activityTs);
  }
  state.summary = {
    current: state.events[state.events.length - 1]?.summary,
    lastCommand: state.lastCommand?.summary,
    lastEdit: state.lastEdit?.summary,
    lastMessage: state.lastMessage?.summary,
    lastTool: state.lastTool?.summary,
    lastPrompt: state.lastPrompt?.summary,
  };
}

function handleRawEvent(raw: any): void {
  const now = nowMs();
  const parsedTs = parseTimestamp(
    raw?.ts ||
      raw?.timestamp ||
      raw?.time ||
      raw?.created_at ||
      raw?.createdAt ||
      raw?.properties?.time ||
      raw?.properties?.timestamp ||
      raw?.properties?.time?.created ||
      raw?.properties?.time?.updated ||
      raw?.properties?.created_at ||
      raw?.properties?.createdAt
  );
  const ts = parsedTs ?? now;
  const sessionId = getSessionId(raw);
  const pid = getPid(raw);
  const { summary, kind, isError, type, inFlight, status } = summarizeEvent(raw);
  const activity = isActivityEvent({
    kind,
    type: typeof type === "string" ? type : undefined,
    inFlight,
  });
  const activityTs = activity ? ts : undefined;
  const entry: EventSummary | null = summary
    ? {
        ts,
        type: typeof type === "string" ? type : "event",
        summary,
        isError,
      }
    : null;
  let touched = false;
  if (sessionId) {
    touched = true;
    const state = ensureActivity(sessionId, sessionActivity, now);
    const prevInFlight = state.inFlight;
    if (entry) {
      recordEvent(state, entry, kind, activityTs);
    } else {
      state.lastEventAt = Math.max(state.lastEventAt || 0, ts);
      if (typeof activityTs === "number") {
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, activityTs);
      }
      if (isError) {
        state.lastError = {
          ts,
          type: typeof type === "string" ? type : "event",
          summary: "error",
          isError,
        };
      }
    }
    if (typeof inFlight === "boolean") {
      state.inFlight = inFlight;
      if (inFlight) {
        state.lastInFlightSignalAt = now;
      } else {
        state.lastInFlightSignalAt = undefined;
      }
    } else if (activity && state.inFlight) {
      state.lastInFlightSignalAt = now;
    }
    if (typeof status === "string" && status.trim()) {
      state.lastStatus = status;
      state.lastStatusAt = now;
      if (status.toLowerCase() === "idle") {
        state.inFlight = false;
        state.lastInFlightSignalAt = undefined;
      } else {
        state.inFlight = true;
        state.lastInFlightSignalAt = now;
      }
    }
    if (prevInFlight !== state.inFlight) {
      logDebug(
        `inFlight ${prevInFlight ? "on" : "off"} -> ${state.inFlight ? "on" : "off"} ` +
          `session=${sessionId} lastEventAt=${state.lastEventAt ?? "?"} ` +
          `lastActivityAt=${state.lastActivityAt ?? "?"}`
      );
    }
  }
  if (typeof pid === "number") {
    touched = true;
    const state = ensureActivity(pid, pidActivity, now);
    if (entry) {
      recordEvent(state, entry, kind, activityTs);
    } else {
      state.lastEventAt = Math.max(state.lastEventAt || 0, ts);
      if (typeof activityTs === "number") {
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, activityTs);
      }
      if (isError) {
        state.lastError = {
          ts,
          type: typeof type === "string" ? type : "event",
          summary: "error",
          isError,
        };
      }
    }
    if (typeof inFlight === "boolean") {
      state.inFlight = inFlight;
      if (inFlight) {
        state.lastInFlightSignalAt = now;
      } else {
        state.lastInFlightSignalAt = undefined;
      }
    } else if (activity && state.inFlight) {
      state.lastInFlightSignalAt = now;
    }
    if (typeof status === "string" && status.trim()) {
      state.lastStatus = status;
      state.lastStatusAt = now;
      if (status.toLowerCase() === "idle") {
        state.inFlight = false;
        state.lastInFlightSignalAt = undefined;
      } else {
        state.inFlight = true;
        state.lastInFlightSignalAt = now;
      }
    }
  }
  if (touched) notifyListeners();
  if (rawListeners.size) notifyRawListeners(raw);
}

export function ingestOpenCodeEvent(raw: unknown): void {
  handleRawEvent(raw);
}

function pruneStale(): void {
  const cutoff = nowMs() - STALE_TTL_MS;
  for (const [key, state] of sessionActivity.entries()) {
    if (state.lastSeenAt < cutoff) sessionActivity.delete(key);
  }
  for (const [key, state] of pidActivity.entries()) {
    if (state.lastSeenAt < cutoff) pidActivity.delete(key);
  }
}

async function connectStream(host: string, port: number): Promise<void> {
  connecting = true;
  lastConnectAt = nowMs();
  try {
    const controller = new AbortController();
    activeAbort = controller;
    const endpoints = ["/global/event", "/event"];
    for (const endpoint of endpoints) {
      const response = await fetch(`http://${host}:${port}${endpoint}`, {
        headers: {
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) continue;
      connected = true;
      connecting = false;
      const reader = response.body.getReader();
      const parser = createParser({
        onEvent: (event) => {
          const payload = event.data;
          if (!payload) return;
          try {
            const parsed = JSON.parse(payload);
            let raw: any = parsed;
            if (parsed && typeof parsed === "object" && parsed.payload && typeof parsed.payload === "object") {
              raw = { ...parsed, ...parsed.payload };
            }
            if (event.event && typeof raw === "object" && raw && !raw.type) {
              raw.type = event.event;
            }
            if (parsed?.type && typeof raw === "object" && raw && !raw.type) {
              raw.type = parsed.type;
            }
            handleRawEvent(raw);
          } catch {
            // ignore malformed payloads
          }
        },
      });
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(Buffer.from(value).toString("utf8"));
      }
      return;
    }
    if (process.env.CONSENSUS_DEBUG_OPENCODE === "1") {
      process.stderr.write(
        `[consensus] opencode SSE connect failed at ${host}:${port}\n`
      );
    }
    lastFailureAt = nowMs();
  } catch {
    lastFailureAt = nowMs();
  } finally {
    connected = false;
    connecting = false;
    if (activeAbort?.signal.aborted) {
      // reset after explicit stop
      activeAbort = null;
    } else if (activeAbort) {
      activeAbort = null;
    }
  }
}

export function ensureOpenCodeEventStream(host: string, port: number): void {
  if (process.env.CONSENSUS_OPENCODE_EVENTS === "0") return;
  const now = nowMs();
  if (activeAbort) return;
  if (connecting || connected) return;
  if (now - lastConnectAt < RECONNECT_MIN_MS) return;
  if (now - lastFailureAt < RECONNECT_MIN_MS) return;
  pruneStale();
  void connectStream(host, port);
}

export function stopOpenCodeEventStream(): void {
  if (!activeAbort) return;
  activeAbort.abort();
  activeAbort = null;
  connected = false;
  connecting = false;
}

export function getOpenCodeActivityBySession(
  sessionId?: string
): {
  events?: EventSummary[];
  summary?: WorkSummary;
  lastEventAt?: number;
  lastActivityAt?: number;
  hasError?: boolean;
  inFlight?: boolean;
  lastStatus?: string;
  lastStatusAt?: number;
} | null {
  if (!sessionId) return null;
  const state = sessionActivity.get(sessionId);
  if (!state) return null;
  expireInFlight(state, nowMs());
  const events = state.events.slice(-20);
  const hasError = !!state.lastError || events.some((ev) => ev.isError);
    return {
      events,
      summary: state.summary,
      lastEventAt: state.lastEventAt,
      lastActivityAt: state.lastActivityAt,
      hasError,
      inFlight: state.inFlight,
      lastStatus: state.lastStatus,
      lastStatusAt: state.lastStatusAt,
    };
  }

export function getOpenCodeActivityByPid(
  pid?: number
): {
  events?: EventSummary[];
  summary?: WorkSummary;
  lastEventAt?: number;
  lastActivityAt?: number;
  hasError?: boolean;
  inFlight?: boolean;
  lastStatus?: string;
  lastStatusAt?: number;
} | null {
  if (typeof pid !== "number") return null;
  const state = pidActivity.get(pid);
  if (!state) return null;
  expireInFlight(state, nowMs());
  const events = state.events.slice(-20);
  const hasError = !!state.lastError || events.some((ev) => ev.isError);
    return {
      events,
      summary: state.summary,
      lastEventAt: state.lastEventAt,
      lastActivityAt: state.lastActivityAt,
      hasError,
      inFlight: state.inFlight,
      lastStatus: state.lastStatus,
      lastStatusAt: state.lastStatusAt,
    };
  }
