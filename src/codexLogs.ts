import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import type { EventSummary, WorkSummary } from "./types.js";
import { redactText } from "./redact.js";

const SESSION_WINDOW_MS = 30 * 60 * 1000;
const SESSION_SCAN_INTERVAL_MS = 500;
const SESSION_ID_SCAN_INTERVAL_MS = 60000;
const MAX_READ_BYTES = 512 * 1024;
const MAX_EVENTS = 50;
const SESSION_META_READ_BYTES = 16 * 1024;
const SESSION_META_RESYNC_MS = 10000;
const SESSION_CWD_CHECK_MAX = 256;
const isDebugActivity = () => process.env.CONSENSUS_DEBUG_ACTIVITY === "1";

function logDebug(message: string): void {
  if (!isDebugActivity()) return;
  process.stderr.write(`[consensus][codex] ${message}\n`);
}

export interface SessionFile {
  path: string;
  mtimeMs: number;
}

interface TailState {
  path: string;
  offset: number;
  partial: string;
  events: EventSummary[];
  recentEvents?: CodexEventLite[];
  lastEventAt?: number;
  lastActivityAt?: number;
  lastIngestAt?: number;
  lastMtimeMs?: number;
  inFlight?: boolean;
  inFlightStart?: boolean;
  lastInFlightSignalAt?: number;
  turnOpen?: boolean;
  openCallIds?: Set<string>;
  lastCommand?: EventSummary;
  lastEdit?: EventSummary;
  lastMessage?: EventSummary;
  lastTool?: EventSummary;
  lastPrompt?: EventSummary;
  lastError?: EventSummary;
  model?: string;
}

export interface CodexEventLite {
  ts: number;
  type: string;
  itemId?: string;
  itemType?: string;
  itemStatus?: string;
  threadId?: string;
  turnId?: string | number;
  payloadType?: string;
  payloadRole?: string;
  callId?: string;
}

let cachedSessions: SessionFile[] = [];
let lastSessionScan = 0;
const tailStates = new Map<string, TailState>();
const sessionIdCache = new Map<string, string | null>();
const sessionIdLastScan = new Map<string, number>();
const sessionMetaCache = new Map<
  string,
  { mtimeMs: number; cwd?: string; id?: string; checkedAt: number }
>();

export function getTailState(sessionPath: string): TailState | undefined {
  return tailStates.get(sessionPath);
}

export function consumeRecentEvents(sessionPath: string): CodexEventLite[] {
  const state = tailStates.get(sessionPath);
  if (!state?.recentEvents || state.recentEvents.length === 0) return [];
  const events = state.recentEvents;
  state.recentEvents = [];
  return events;
}

export async function getSessionMeta(
  sessionPath: string
): Promise<{ cwd?: string; id?: string } | null> {
  const cached = sessionMetaCache.get(sessionPath);
  if (cached && (cached.id || cached.cwd)) {
    return { cwd: cached.cwd, id: cached.id };
  }

  const now = Date.now();
  if (cached && now - cached.checkedAt < SESSION_META_RESYNC_MS) {
    return null;
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(sessionPath);
  } catch {
    return null;
  }

  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.id || cached.cwd ? { cwd: cached.cwd, id: cached.id } : null;
  }

  try {
    const handle = await fsp.open(sessionPath, "r");
    const buffer = Buffer.alloc(SESSION_META_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    await handle.close();
    const text = buffer.slice(0, bytesRead).toString("utf8");
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim().startsWith("{")) continue;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev?.type === "session_meta" && ev?.payload) {
        const cwd = typeof ev.payload.cwd === "string" ? ev.payload.cwd : undefined;
        const id = typeof ev.payload.id === "string" ? ev.payload.id : undefined;
        const meta = { mtimeMs: stat.mtimeMs, cwd, id, checkedAt: now };
        sessionMetaCache.set(sessionPath, meta);
        return meta;
      }
    }
  } catch {
    sessionMetaCache.set(sessionPath, { mtimeMs: stat.mtimeMs, checkedAt: now });
    return null;
  }

  sessionMetaCache.set(sessionPath, { mtimeMs: stat.mtimeMs, checkedAt: now });
  return null;
}

export async function findSessionByCwd(
  sessions: SessionFile[],
  cwd?: string,
  startMs?: number
): Promise<SessionFile | undefined> {
  if (!cwd) return undefined;
  const target = path.resolve(cwd);
  let best: SessionFile | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const session of sessions.slice(0, SESSION_CWD_CHECK_MAX)) {
    const meta = await getSessionMeta(session.path);
    if (!meta?.cwd) continue;
    if (path.resolve(meta.cwd) !== target) continue;
    if (startMs === undefined) return session;
    const delta = Math.abs(session.mtimeMs - startMs);
    if (delta < bestDelta) {
      best = session;
      bestDelta = delta;
    }
  }
  return best;
}

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CONSENSUS_CODEX_HOME || env.CODEX_HOME;
  if (!override) return path.join(os.homedir(), ".codex");
  if (override === "~") {
    return os.homedir();
  }
  if (override.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), override.slice(2));
  }
  return path.resolve(override);
}

async function walk(dir: string, out: SessionFile[], windowMs: number): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, out, windowMs);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
      try {
        const stat = await fsp.stat(fullPath);
        if (now - stat.mtimeMs <= windowMs) {
          out.push({ path: fullPath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        return;
      }
    })
  );
}

async function findSessionFile(
  dir: string,
  sessionId: string
): Promise<SessionFile | undefined> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findSessionFile(fullPath, sessionId);
      if (found) return found;
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    if (!entry.name.includes(sessionId)) continue;
    try {
      const stat = await fsp.stat(fullPath);
      return { path: fullPath, mtimeMs: stat.mtimeMs };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function listRecentSessions(
  codexHome: string,
  windowMs: number = SESSION_WINDOW_MS
): Promise<SessionFile[]> {
  const now = Date.now();
  if (now - lastSessionScan < SESSION_SCAN_INTERVAL_MS) {
    return cachedSessions.filter((item) => now - item.mtimeMs <= windowMs);
  }
  lastSessionScan = now;
  const sessionsDir = path.join(codexHome, "sessions");
  const results: SessionFile[] = [];
  await walk(sessionsDir, results, windowMs);
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  cachedSessions = results;
  return results;
}

export async function findSessionById(
  codexHome: string,
  sessionId: string
): Promise<SessionFile | undefined> {
  const now = Date.now();
  const lastScan = sessionIdLastScan.get(sessionId) || 0;
  if (now - lastScan < SESSION_ID_SCAN_INTERVAL_MS) {
    const cached = sessionIdCache.get(sessionId);
    if (cached) {
      try {
        const stat = await fsp.stat(cached);
        return { path: cached, mtimeMs: stat.mtimeMs };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  sessionIdLastScan.set(sessionId, now);
  const sessionsDir = path.join(codexHome, "sessions");
  const found = await findSessionFile(sessionsDir, sessionId);
  sessionIdCache.set(sessionId, found ? found.path : null);
  return found;
}

export function pickSessionForProcess(
  sessions: SessionFile[],
  startTimeMs?: number
): SessionFile | undefined {
  if (sessions.length === 0) return undefined;
  if (!startTimeMs) return sessions[0];
  let best = sessions[0];
  let bestDelta = Math.abs(best.mtimeMs - startTimeMs);
  for (const session of sessions) {
    const delta = Math.abs(session.mtimeMs - startTimeMs);
    if (delta < bestDelta) {
      best = session;
      bestDelta = delta;
    }
  }
  return best;
}

function getEventTimestamp(ev: any): number {
  const ts = ev.ts || ev.timestamp || ev.time || ev.created_at || ev.createdAt;
  if (typeof ts === "number") {
    if (ts < 100_000_000_000) {
      return ts * 1000;
    }
    return ts;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function extractModel(ev: any): string | undefined {
  const model = ev.model || ev?.metadata?.model || ev?.data?.model || ev?.item?.model;
  return typeof model === "string" ? model : undefined;
}

function extractText(value: any): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    if (typeof value.content === "string") return value.content;
    if (typeof value.text === "string") return value.text;
    if (typeof value.message === "string") return value.message;
    if (value.message && typeof value.message.content === "string") return value.message.content;
  }
  return undefined;
}

function summarizeEvent(ev: any): {
  summary?: string;
  kind?: "command" | "edit" | "message" | "prompt" | "tool" | "other";
  isError?: boolean;
  model?: string;
  type?: string;
} {
  const item =
    ev?.item ||
    ev?.data?.item ||
    ev?.delta?.item ||
    ev?.message?.item ||
    ev?.payload ||
    ev?.data?.payload;
  const rawType = ev?.type || ev?.event?.type || "event";
  const rawItemType = item?.type || item?.item_type || item?.itemType;
  const type =
    typeof rawType === "string"
      ? rawType
      : typeof rawItemType === "string"
        ? rawItemType
        : "event";

  const status = item?.status || ev?.status || ev?.error?.status;
  const isError =
    !!ev?.error ||
    type.includes("error") ||
    status === "error" ||
    status === "failed" ||
    status === "failure";

  const model = extractModel(ev);

  const itemType = typeof rawItemType === "string" ? rawItemType : undefined;
  const roleRaw = item?.role || item?.message?.role || ev?.role;
  const role = typeof roleRaw === "string" ? roleRaw : undefined;
  const itemTypeLower = typeof itemType === "string" ? itemType.toLowerCase() : "";
  const hasEncrypted =
    typeof item?.encrypted_content === "string" && item.encrypted_content.length > 0;
  const hasSummaryArray = Array.isArray(item?.summary) && item.summary.length > 0;

  const cmd =
    item?.command ||
    item?.cmd ||
    item?.input?.command ||
    item?.input?.cmd ||
    (Array.isArray(item?.args) ? item.args.join(" ") : undefined) ||
    ev?.command ||
    ev?.cmd;
  if (typeof cmd === "string" && cmd.trim()) {
    const summary = redactText(`cmd: ${cmd.trim()}`) || `cmd: ${cmd.trim()}`;
    return { summary, kind: "command", isError, model, type };
  }

  const pathHint = item?.path || item?.file || item?.filename || item?.target || ev?.path;
  const editTypes = new Set(["file_change", "file_edit", "file_write"]);
  if (
    typeof pathHint === "string" &&
    pathHint.trim() &&
    (editTypes.has(itemType || "") || /file_change|file_edit|file_write/i.test(type))
  ) {
    const summary = redactText(`edit: ${pathHint.trim()}`) || `edit: ${pathHint.trim()}`;
    return { summary, kind: "edit", isError, model, type };
  }

  const toolName =
    item?.tool_name ||
    item?.tool?.name ||
    item?.tool ||
    item?.name ||
    item?.call?.name ||
    item?.function?.name ||
    ev?.tool_name ||
    ev?.tool?.name ||
    ev?.tool;
  const toolTypes = new Set([
    "tool_call",
    "mcp_tool_call",
    "tool",
    "tool_execution",
    "function_call",
    "function_call_output",
    "custom_tool_call",
    "custom_tool_call_output",
  ]);
  if (
    typeof toolName === "string" &&
    toolName.trim() &&
    (toolTypes.has(itemType || "") || /tool/i.test(type))
  ) {
    const summary = redactText(`tool: ${toolName.trim()}`) || `tool: ${toolName.trim()}`;
    return { summary, kind: "tool", isError, model, type };
  }
  if (
    (itemTypeLower.includes("tool") || itemTypeLower.includes("function_call")) &&
    (toolTypes.has(itemTypeLower) || /tool|function_call/i.test(String(itemType)))
  ) {
    const fallback =
      (typeof item?.call_id === "string" && item.call_id) ||
      (typeof item?.name === "string" && item.name) ||
      itemTypeLower.replace(/_/g, " ");
    const summary = redactText(`tool: ${fallback}`) || `tool: ${fallback}`;
    return { summary, kind: "tool", isError, model, type };
  }

  const promptText =
    extractText(item?.input) ||
    extractText(item?.prompt) ||
    extractText(item?.instruction) ||
    extractText(ev?.input) ||
    extractText(ev?.prompt) ||
    extractText(ev?.instruction) ||
    extractText(ev?.data?.input) ||
    extractText(ev?.data?.prompt);
  const messageText =
    extractText(item?.content) ||
    extractText(item?.message) ||
    extractText(ev?.message) ||
    extractText(item?.text) ||
    extractText(ev?.text);
  const isReasoning = itemTypeLower.includes("reasoning");
  const isAgentMessage = itemTypeLower.includes("agent_message");
  if ((isReasoning || isAgentMessage) && !messageText && (hasEncrypted || hasSummaryArray)) {
    const summary = isReasoning ? "thinking" : "message";
    return { summary, kind: "message", isError, model, type };
  }
  if (isAgentMessage && !messageText) {
    return { summary: "message", kind: "message", isError, model, type };
  }
  if (messageText && itemType !== "reasoning") {
    const trimmed = messageText.replace(/\s+/g, " ").trim();
    if (trimmed) {
      const snippet = trimmed.slice(0, 120);
      const isAssistant =
        role === "assistant" ||
        itemTypeLower.includes("assistant_message") ||
        itemTypeLower.includes("assistant_response") ||
        itemTypeLower.includes("agent_message") ||
        itemTypeLower.includes("agent_reasoning");
      const isUser =
        role === "user" ||
        itemTypeLower.includes("user_message") ||
        itemTypeLower.includes("user_prompt");
      const isSystem =
        role === "system" ||
        role === "developer" ||
        itemTypeLower.includes("system_message") ||
        itemTypeLower.includes("developer_message") ||
        itemTypeLower.includes("token_count");
      if (isAssistant) {
        const summary = redactText(snippet) || snippet;
        return { summary, kind: "message", isError, model, type };
      }
      if (isUser) {
        const summary = redactText(`prompt: ${snippet}`) || `prompt: ${snippet}`;
        return { summary, kind: "prompt", isError, model, type };
      }
      if (isSystem) {
        return { kind: "other", isError, model, type };
      }
    }
  }

  if (
    promptText &&
    (itemType === "prompt" || /thread\.started|turn\.started|prompt/i.test(String(type)))
  ) {
    const trimmed = promptText.replace(/\s+/g, " ").trim();
    if (trimmed) {
      const snippet = trimmed.slice(0, 120);
      const summary = redactText(`prompt: ${snippet}`) || `prompt: ${snippet}`;
      return { summary, kind: "prompt", isError, model, type };
    }
  }

  const fallbackBits = [
    typeof type === "string" && type !== "event" ? type : undefined,
    itemType,
  ].filter(Boolean);
  if (fallbackBits.length) {
    const summary = redactText(`event: ${fallbackBits.join(" ")}`) || `event: ${fallbackBits.join(" ")}`;
    return { summary, kind: "other", isError, model, type };
  }

  return { kind: "other", isError, model, type };
}

export async function updateTail(sessionPath: string): Promise<TailState | null> {
  const nowMs = Date.now();
  const inflightTimeoutMs = Number(
    process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS || 5000
  );
  const signalFreshMs = Number(
    process.env.CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS || inflightTimeoutMs
  );
  const fileFreshMs = Number(
    process.env.CONSENSUS_CODEX_FILE_FRESH_MS || 1500
  );
  const staleFileMs = Number(process.env.CONSENSUS_CODEX_STALE_FILE_MS || 120000);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(sessionPath);
  } catch {
    return null;
  }
  const fileFresh =
    Number.isFinite(fileFreshMs) &&
    fileFreshMs > 0 &&
    nowMs - stat.mtimeMs <= fileFreshMs;
  const isStaleFile =
    Number.isFinite(staleFileMs) && staleFileMs > 0 && nowMs - stat.mtimeMs > staleFileMs;

  const prev = tailStates.get(sessionPath);
  const state: TailState =
    prev ||
    ({
      path: sessionPath,
      offset: 0,
      partial: "",
      events: [],
    } as TailState);
  state.recentEvents = [];
  state.lastMtimeMs = stat.mtimeMs;
  const markInFlightSignal = () => {
    state.lastInFlightSignalAt = nowMs;
  };
  const clearActivitySignals = () => {
    state.lastInFlightSignalAt = undefined;
    state.lastIngestAt = undefined;
  };

  const expireInFlight = () => {
    if (!state.inFlight) return;
    if (fileFresh) {
      return;
    }
    const lastSignal =
      state.lastInFlightSignalAt ??
      state.lastIngestAt ??
      state.lastActivityAt ??
      state.lastEventAt;
    if (
      typeof lastSignal === "number" &&
      nowMs - lastSignal > inflightTimeoutMs
    ) {
      state.inFlight = false;
      state.inFlightStart = false;
      clearActivitySignals();
    }
  };

  if (isStaleFile) {
    if (state.inFlight) {
      state.inFlight = false;
      state.inFlightStart = false;
      state.turnOpen = false;
      state.lastInFlightSignalAt = undefined;
      if (state.openCallIds) state.openCallIds.clear();
    }
    state.lastEventAt = undefined;
    state.lastActivityAt = undefined;
    state.lastIngestAt = undefined;
  }

  if (stat.size < state.offset) {
    state.offset = 0;
    state.partial = "";
    state.events = [];
    state.lastEventAt = undefined;
    state.lastCommand = undefined;
    state.lastEdit = undefined;
    state.lastMessage = undefined;
    state.lastTool = undefined;
    state.lastError = undefined;
    state.model = undefined;
    state.inFlight = false;
    state.inFlightStart = undefined;
    state.turnOpen = undefined;
    state.openCallIds = undefined;
    state.lastInFlightSignalAt = undefined;
  }

  if (stat.size === state.offset) {
    expireInFlight();
    tailStates.set(sessionPath, state);
    return state;
  }

  const prevOffset = state.offset;
  let readStart = prevOffset;
  let trimmed = false;
  const delta = stat.size - prevOffset;
  if (delta > MAX_READ_BYTES) {
    readStart = Math.max(0, stat.size - MAX_READ_BYTES);
    trimmed = true;
    state.partial = "";
  }

  if (stat.size <= readStart) {
    tailStates.set(sessionPath, state);
    return state;
  }

  const readLength = stat.size - readStart;
  const buffer = Buffer.alloc(readLength);
  try {
    const handle = await fsp.open(sessionPath, "r");
    await handle.read(buffer, 0, readLength, readStart);
    await handle.close();
  } catch {
    return null;
  }

  let text = buffer.toString("utf8");
  if (trimmed) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1) {
      text = text.slice(firstNewline + 1);
    }
  }

  const combined = state.partial + text;
  const lines = combined.split(/\r?\n/);
  state.partial = lines.pop() || "";

  const responseStartRe = /(?:turn|response)\.(started|in_progress|running)/i;
  const responseEndRe =
    /response\.(completed|failed|errored|canceled|cancelled|aborted|interrupted|stopped)/i;
  const responseDeltaTypes = new Set([
    "response.output_text.delta",
    "response.function_call_arguments.delta",
    "response.content_part.delta",
    "response.text.delta",
  ]);
  const workKinds = new Set(["command", "edit", "tool", "message"]);
  const processLine = (line: string): boolean => {
    if (!line.trim()) return false;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      return false;
    }
    const ts = getEventTimestamp(ev);
    const signalFresh =
      fileFresh ||
      (Number.isFinite(signalFreshMs) && signalFreshMs > 0
        ? nowMs - ts <= signalFreshMs
        : true);
    const canSignal = !isStaleFile && signalFresh;
    const { summary, kind, isError, model, type } = summarizeEvent(ev);
    const typeStrRaw = typeof type === "string" ? type : "";
    const typeStr = typeStrRaw.toLowerCase();
    const item =
      ev?.item ||
      ev?.data?.item ||
      ev?.delta?.item ||
      ev?.message?.item ||
      ev?.payload ||
      ev?.data?.payload;
    const itemTypeRaw = item?.type || item?.item_type || item?.itemType;
    const itemTypeLower =
      typeof itemTypeRaw === "string" ? itemTypeRaw.toLowerCase() : "";
    if (model) state.model = model;
  const payload =
    ev?.payload ||
    ev?.data?.payload ||
    (item && typeof item === "object" ? item : undefined);
  const payloadTypeRaw = payload?.type;
  const payloadType =
    typeof payloadTypeRaw === "string" ? payloadTypeRaw.toLowerCase() : "";
  const payloadRoleRaw = payload?.role;
  const payloadRole =
    typeof payloadRoleRaw === "string" ? payloadRoleRaw.toLowerCase() : "";
  const callIdRaw =
    payload?.call_id ||
    payload?.callId ||
    payload?.id ||
    payload?.name;
    const callId = typeof callIdRaw === "string" ? callIdRaw : undefined;
    const threadIdRaw =
      ev?.thread_id || ev?.threadId || ev?.thread?.id || ev?.payload?.thread_id;
    const threadId = typeof threadIdRaw === "string" ? threadIdRaw : undefined;
    const turnIdRaw =
      ev?.turn_id ||
      ev?.turnId ||
      ev?.turn?.id ||
      ev?.turn?.index ||
      ev?.payload?.turn_id;
    const turnId =
      typeof turnIdRaw === "string" || typeof turnIdRaw === "number"
        ? turnIdRaw
        : undefined;
    const itemIdRaw = item?.id || item?.item_id || item?.itemId;
    const itemId = typeof itemIdRaw === "string" ? itemIdRaw : undefined;
    const itemStatusRaw = item?.status || item?.state;
    const itemStatus = typeof itemStatusRaw === "string" ? itemStatusRaw : undefined;
    state.recentEvents?.push({
      ts,
      type: typeStrRaw || "event",
      itemId,
      itemType: typeof itemTypeRaw === "string" ? itemTypeRaw : undefined,
      itemStatus,
      threadId,
      turnId,
      payloadType,
      payloadRole,
      callId,
    });
    const isResponseStart = responseStartRe.test(typeStr);
    const isResponseEnd = responseEndRe.test(typeStr);
    const isTurnEnd = /turn\.(completed|failed|errored|canceled|cancelled|aborted|interrupted|stopped)/i.test(
      typeStr
    );
    const isTurnStart = typeStr === "turn.started";
    const isResponseDelta = responseDeltaTypes.has(typeStr);
    const isItemStarted = typeStr === "item.started";
    const itemStartWorkTypes = new Set([
      "command_execution",
      "mcp_tool_call",
      "tool_call",
      "file_change",
      "file_edit",
      "file_write",
    ]);
    if (typeof type === "string") {
      if (isTurnStart) {
        state.turnOpen = true;
        if (canSignal) {
          state.inFlight = true;
          state.inFlightStart = true;
          markInFlightSignal();
        }
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
      }
      if (isResponseStart) {
        state.turnOpen = true;
        if (canSignal) {
          state.inFlight = true;
          state.inFlightStart = true;
          markInFlightSignal();
        }
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
      }
      if (isItemStarted && itemStartWorkTypes.has(itemTypeLower)) {
        if (canSignal) {
          state.turnOpen = true;
          state.inFlight = true;
          state.inFlightStart = true;
          markInFlightSignal();
        }
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
      }
      if (isResponseDelta) {
        state.turnOpen = true;
        if (canSignal) {
          state.inFlight = true;
          state.inFlightStart = true;
          markInFlightSignal();
        }
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
      }
    }
  if (payloadType.includes("agent_reasoning") || payloadType === "reasoning") {
    if (canSignal) {
      state.turnOpen = true;
      state.inFlight = true;
      state.inFlightStart = true;
      markInFlightSignal();
    }
  }
  if (payloadType === "token_count") {
    if (canSignal) {
      state.turnOpen = true;
      if (!state.inFlight) {
        state.inFlight = true;
        state.inFlightStart = true;
      }
      markInFlightSignal();
      state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    }
  }
    if (type === "response_item") {
      const isAssistant =
        payloadRole === "assistant" ||
        payloadType.includes("assistant") ||
        payloadType.includes("reasoning") ||
        payloadType.includes("agent_reasoning");
      const isToolOutput =
        payloadType.includes("function_call_output") ||
        payloadType.includes("custom_tool_call_output") ||
        payloadType.includes("tool_call_output");
      const isToolCall =
        !isToolOutput &&
        (payloadType.includes("function_call") ||
          payloadType.includes("custom_tool_call") ||
          payloadType.includes("tool_call") ||
          payloadType === "tool");
      if (isToolCall) {
        if (!state.openCallIds) state.openCallIds = new Set();
        if (callId) state.openCallIds.add(callId);
        if (canSignal) {
          state.turnOpen = true;
          state.inFlight = true;
          state.inFlightStart = true;
          markInFlightSignal();
        }
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
      }
      const isReasoning = payloadType === "reasoning" || payloadType.includes("reasoning");
      const isAssistantMessage = payloadType === "message" && payloadRole === "assistant";
      if ((isReasoning || isAssistantMessage) && canSignal) {
        state.turnOpen = true;
        state.inFlight = true;
        state.inFlightStart = true;
        markInFlightSignal();
      }
      if (isToolOutput) {
        if (state.openCallIds && callId) {
          state.openCallIds.delete(callId);
        }
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
      }
      if (payloadType === "reasoning") {
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
        if (canSignal && state.inFlight) {
          markInFlightSignal();
        }
      }
      if (payloadType === "message") {
        if (payloadRole === "assistant") {
          state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
          if (canSignal && state.inFlight) {
            markInFlightSignal();
          }
        }
      }
      if (isAssistant && !isToolCall && payloadType !== "message") {
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
        if (canSignal && state.inFlight) {
          markInFlightSignal();
        }
      }
    }
    if (isResponseEnd) {
      if (state.openCallIds) state.openCallIds.clear();
      state.turnOpen = false;
      state.inFlight = false;
      state.inFlightStart = false;
      clearActivitySignals();
    }
  const itemTypeIsAgentReasoning = itemTypeLower.includes("agent_reasoning");
  const itemTypeIsAgentMessage = itemTypeLower.includes("agent_message");
  const itemTypeIsUserMessage = itemTypeLower.includes("user_message");
    const itemTypeIsTurnAbort = itemTypeLower.includes("turn_aborted");
  const payloadIsAgentMessage =
    payloadType === "agent_message" || payloadType === "assistant_message";
  const payloadIsUserMessage = payloadType === "user_message";
  if (itemTypeIsAgentReasoning) {
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    if (canSignal) {
      state.turnOpen = true;
      if (!state.inFlight) {
        state.inFlight = true;
        state.inFlightStart = true;
      }
      markInFlightSignal();
    }
  }
  if (itemTypeIsUserMessage || payloadIsUserMessage) {
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    if (canSignal) {
      state.turnOpen = true;
      state.inFlight = true;
      state.inFlightStart = true;
      markInFlightSignal();
    }
  }
  if (itemTypeIsAgentMessage || payloadIsAgentMessage) {
    state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
    if (canSignal) {
      if (!state.inFlight) {
        state.inFlight = true;
        state.inFlightStart = true;
      }
      markInFlightSignal();
    }
  }
    if (itemTypeIsTurnAbort) {
      if (state.openCallIds) state.openCallIds.clear();
      state.inFlight = false;
      state.inFlightStart = false;
      clearActivitySignals();
    }
    if (isTurnEnd) {
      if (state.openCallIds) state.openCallIds.clear();
      state.turnOpen = false;
      state.inFlight = false;
      state.inFlightStart = false;
      clearActivitySignals();
    }

    if (summary) {
      const entry: EventSummary = {
        ts,
        type: typeof type === "string" ? type : "event",
        summary,
        isError,
      };
      state.events.push(entry);
      state.lastEventAt = Math.max(state.lastEventAt || 0, ts);
      if (kind === "command") state.lastCommand = entry;
      if (kind === "edit") state.lastEdit = entry;
      if (kind === "message") state.lastMessage = entry;
      if (kind === "tool") state.lastTool = entry;
      if (kind === "prompt") state.lastPrompt = entry;
      if (kind && workKinds.has(kind) && !isItemStarted) {
        state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
      }
      if (kind === "message") {
        if (itemTypeIsAgentReasoning && !isItemStarted) {
          state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
          if (canSignal && state.inFlight) {
            markInFlightSignal();
          }
        }
        if (itemTypeIsAgentMessage) {
          state.lastActivityAt = Math.max(state.lastActivityAt || 0, ts);
          if (canSignal && state.inFlight) {
            markInFlightSignal();
          }
        }
      }
      if (isError) state.lastError = entry;
      if (state.events.length > MAX_EVENTS) {
        state.events = state.events.slice(-MAX_EVENTS);
      }
      return true;
    }
    if (
      payloadType === "token_count" &&
      state.inFlight
    ) {
      return true;
    }
    state.lastEventAt = Math.max(state.lastEventAt || 0, ts);
    if (isError) {
      state.lastError = {
        ts,
        type: typeof type === "string" ? type : "event",
        summary: "error",
        isError,
      };
      return true;
    }
    return true;
  };

  const prevInFlight = state.inFlight;
  let parsedAny = false;
  for (const line of lines) {
    if (processLine(line)) parsedAny = true;
  }
  const candidate = state.partial.trim();
  if (candidate.startsWith("{") && candidate.endsWith("}")) {
    if (processLine(candidate)) {
      parsedAny = true;
      state.partial = "";
    }
  }

  if (parsedAny) {
    state.lastIngestAt = nowMs;
    if (state.inFlight) {
      markInFlightSignal();
    }
  }

  state.offset = stat.size;
  expireInFlight();
  tailStates.set(sessionPath, state);
  if (prevInFlight !== state.inFlight) {
    const base = path.basename(sessionPath);
    logDebug(
      `inFlight ${prevInFlight ? "on" : "off"} -> ${state.inFlight ? "on" : "off"} ` +
        `session=${base} turnOpen=${state.turnOpen ? 1 : 0} ` +
        `openCalls=${state.openCallIds?.size ?? 0} ` +
        `lastSignal=${state.lastInFlightSignalAt ?? "?"} ` +
        `lastEvent=${state.lastEventAt ?? "?"} lastActivity=${state.lastActivityAt ?? "?"} ` +
        `lastIngest=${state.lastIngestAt ?? "?"}`
    );
  }
  return state;
}

export function summarizeTail(state: TailState): {
  doing?: string;
  title?: string;
  events: EventSummary[];
  model?: string;
  hasError: boolean;
  summary: WorkSummary;
  lastEventAt?: number;
  lastActivityAt?: number;
  lastPromptAt?: number;
  lastInFlightSignalAt?: number;
  lastIngestAt?: number;
  inFlight?: boolean;
} {
  const title = state.lastPrompt?.summary;
  const doing =
    state.lastCommand?.summary ||
    state.lastEdit?.summary ||
    state.lastMessage?.summary ||
    state.events[state.events.length - 1]?.summary;
  const events = state.events.slice(-20);
  const hasError = !!state.lastError || events.some((event) => event.isError);
  const lastEventAt = state.lastEventAt || events[events.length - 1]?.ts;
  const summary: WorkSummary = {
    current: doing,
    lastCommand: state.lastCommand?.summary,
    lastEdit: state.lastEdit?.summary,
    lastMessage: state.lastMessage?.summary,
    lastTool: state.lastTool?.summary,
    lastPrompt: state.lastPrompt?.summary,
  };
  return {
    doing,
    title,
    events,
    model: state.model,
    hasError,
    summary,
    lastEventAt,
    lastActivityAt: state.lastActivityAt,
    lastPromptAt: state.lastPrompt?.ts,
    lastInFlightSignalAt: state.lastInFlightSignalAt,
    lastIngestAt: state.lastIngestAt,
    inFlight: state.inFlight,
  };
}
