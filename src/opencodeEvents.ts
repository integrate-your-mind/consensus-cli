import type { EventSummary, WorkSummary } from "./types.js";
import { redactText } from "./redact.js";

const MAX_EVENTS = 50;
const STALE_TTL_MS = 30 * 60 * 1000;
const RECONNECT_MIN_MS = 10_000;

interface ActivityState {
  events: EventSummary[];
  summary: WorkSummary;
  lastEventAt?: number;
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

let connecting = false;
let connected = false;
let lastConnectAt = 0;
let lastFailureAt = 0;

function nowMs(): number {
  return Date.now();
}

function parseTimestamp(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 100_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return nowMs();
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
  return (
    raw?.sessionId ||
    raw?.session_id ||
    raw?.session?.id ||
    raw?.session?.sessionId ||
    raw?.properties?.sessionId ||
    raw?.properties?.session_id
  );
}

function getPid(raw: any): number | undefined {
  const pid =
    raw?.pid ||
    raw?.process?.pid ||
    raw?.properties?.pid ||
    raw?.properties?.processId;
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
  const status = raw?.status || raw?.state || raw?.properties?.status;
  const statusStr = typeof status === "string" ? status.toLowerCase() : "";
  const isError =
    !!raw?.error || lowerType.includes("error") || statusStr.includes("error");
  let inFlight: boolean | undefined;
  if (
    lowerType.includes("started") ||
    statusStr.includes("started") ||
    statusStr.includes("running") ||
    statusStr.includes("processing") ||
    statusStr.includes("in_progress")
  ) {
    inFlight = true;
  } else if (
    lowerType.includes("completed") ||
    lowerType.includes("finished") ||
    lowerType.includes("done") ||
    lowerType.includes("ended") ||
    statusStr.includes("completed") ||
    statusStr.includes("finished") ||
    statusStr.includes("done") ||
    statusStr.includes("ended") ||
    statusStr.includes("idle") ||
    statusStr.includes("stopped") ||
    statusStr.includes("paused") ||
    isError
  ) {
    inFlight = false;
  }

  if (lowerType.includes("compaction")) {
    const phase = statusStr || raw?.phase || raw?.properties?.phase;
    const summary = phase ? `compaction: ${phase}` : "compaction";
    return { summary, kind: "other", isError, type, inFlight };
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
    return { summary, kind: "command", isError, type, inFlight };
  }

  const pathHint =
    raw?.path ||
    raw?.file ||
    raw?.filename ||
    raw?.target ||
    raw?.properties?.path ||
    raw?.properties?.file;
  if (typeof pathHint === "string" && pathHint.trim() && lowerType.includes("file")) {
    const summary = redactText(`edit: ${pathHint.trim()}`) || `edit: ${pathHint.trim()}`;
    return { summary, kind: "edit", isError, type, inFlight };
  }

  const tool =
    raw?.tool ||
    raw?.tool_name ||
    raw?.toolName ||
    raw?.properties?.tool ||
    raw?.properties?.tool_name;
  if (typeof tool === "string" && tool.trim() && lowerType.includes("tool")) {
    const summary = redactText(`tool: ${tool.trim()}`) || `tool: ${tool.trim()}`;
    return { summary, kind: "tool", isError, type, inFlight };
  }

  const promptText =
    extractText(raw?.prompt) ||
    extractText(raw?.input) ||
    extractText(raw?.instruction) ||
    extractText(raw?.properties?.prompt);
  if (promptText && lowerType.includes("prompt")) {
    const trimmed = promptText.replace(/\s+/g, " ").trim();
    const snippet = trimmed.slice(0, 120);
    const summary = redactText(`prompt: ${snippet}`) || `prompt: ${snippet}`;
    return { summary, kind: "prompt", isError, type, inFlight };
  }

  const messageText =
    extractText(raw?.message) ||
    extractText(raw?.content) ||
    extractText(raw?.text) ||
    extractText(raw?.properties?.message);
  if (messageText) {
    const trimmed = messageText.replace(/\s+/g, " ").trim();
    const snippet = trimmed.slice(0, 80);
    const summary = redactText(snippet) || snippet;
    return { summary, kind: "message", isError, type, inFlight };
  }

  if (type && type !== "event") {
    const summary = redactText(`event: ${type}`) || `event: ${type}`;
    return { summary, kind: "other", isError, type, inFlight };
  }

  return { kind: "other", isError, type, inFlight };
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

function recordEvent(state: ActivityState, entry: EventSummary, kind?: string): void {
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
  const ts = parseTimestamp(
    raw?.ts ||
      raw?.timestamp ||
      raw?.time ||
      raw?.created_at ||
      raw?.createdAt ||
      raw?.properties?.time ||
      raw?.properties?.timestamp
  );
  const sessionId = getSessionId(raw);
  const pid = getPid(raw);
  const { summary, kind, isError, type, inFlight } = summarizeEvent(raw);
  const entry: EventSummary | null = summary
    ? {
        ts,
        type: typeof type === "string" ? type : "event",
        summary,
        isError,
      }
    : null;
  const now = nowMs();
  if (sessionId) {
    const state = ensureActivity(sessionId, sessionActivity, now);
    if (entry) {
      recordEvent(state, entry, kind);
    } else {
      state.lastEventAt = Math.max(state.lastEventAt || 0, ts);
      if (isError) {
        state.lastError = {
          ts,
          type: typeof type === "string" ? type : "event",
          summary: "error",
          isError,
        };
      }
    }
    if (typeof inFlight === "boolean") state.inFlight = inFlight;
  }
  if (typeof pid === "number") {
    const state = ensureActivity(pid, pidActivity, now);
    if (entry) {
      recordEvent(state, entry, kind);
    } else {
      state.lastEventAt = Math.max(state.lastEventAt || 0, ts);
      if (isError) {
        state.lastError = {
          ts,
          type: typeof type === "string" ? type : "event",
          summary: "error",
          isError,
        };
      }
    }
    if (typeof inFlight === "boolean") state.inFlight = inFlight;
  }
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
    const response = await fetch(`http://${host}:${port}/global/event`, {
      headers: {
        Accept: "text/event-stream",
      },
    });
    if (!response.ok || !response.body) {
      connected = false;
      connecting = false;
      lastFailureAt = nowMs();
      return;
    }
    connected = true;
    connecting = false;
    const reader = response.body.getReader();
    let buffer = "";
    let currentEvent: string | undefined;
    let dataLines: string[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += Buffer.from(value).toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trimEnd();
        buffer = buffer.slice(idx + 1);
        if (!line) {
          if (dataLines.length) {
            const payload = dataLines.join("\n");
            try {
              const parsed = JSON.parse(payload);
              const raw = parsed?.payload ?? parsed;
              if (currentEvent && typeof raw === "object" && !raw.type) {
                raw.type = currentEvent;
              }
              if (parsed?.type && typeof raw === "object" && !raw.type) {
                raw.type = parsed.type;
              }
              handleRawEvent(raw);
            } catch {
              // ignore malformed payloads
            }
          }
          currentEvent = undefined;
          dataLines = [];
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }
  } catch {
    lastFailureAt = nowMs();
  } finally {
    connected = false;
    connecting = false;
  }
}

export function ensureOpenCodeEventStream(host: string, port: number): void {
  if (process.env.CONSENSUS_OPENCODE_EVENTS === "0") return;
  const now = nowMs();
  if (connecting || connected) return;
  if (now - lastConnectAt < RECONNECT_MIN_MS) return;
  if (now - lastFailureAt < RECONNECT_MIN_MS) return;
  pruneStale();
  void connectStream(host, port);
}

export function getOpenCodeActivityBySession(
  sessionId?: string
): {
  events?: EventSummary[];
  summary?: WorkSummary;
  lastEventAt?: number;
  hasError?: boolean;
  inFlight?: boolean;
} | null {
  if (!sessionId) return null;
  const state = sessionActivity.get(sessionId);
  if (!state) return null;
  const events = state.events.slice(-20);
  const hasError = !!state.lastError || events.some((ev) => ev.isError);
  return {
    events,
    summary: state.summary,
    lastEventAt: state.lastEventAt,
    hasError,
    inFlight: state.inFlight,
  };
}

export function getOpenCodeActivityByPid(
  pid?: number
): {
  events?: EventSummary[];
  summary?: WorkSummary;
  lastEventAt?: number;
  hasError?: boolean;
  inFlight?: boolean;
} | null {
  if (typeof pid !== "number") return null;
  const state = pidActivity.get(pid);
  if (!state) return null;
  const events = state.events.slice(-20);
  const hasError = !!state.lastError || events.some((ev) => ev.isError);
  return {
    events,
    summary: state.summary,
    lastEventAt: state.lastEventAt,
    hasError,
    inFlight: state.inFlight,
  };
}
