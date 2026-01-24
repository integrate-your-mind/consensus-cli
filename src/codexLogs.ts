import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import type { EventSummary, WorkSummary } from "./types.js";
import { redactText } from "./redact.js";

const SESSION_WINDOW_MS = 30 * 60 * 1000;
const SESSION_SCAN_INTERVAL_MS = 5000;
const SESSION_ID_SCAN_INTERVAL_MS = 60000;
const MAX_READ_BYTES = 512 * 1024;
const MAX_EVENTS = 50;

export interface SessionFile {
  path: string;
  mtimeMs: number;
}

interface TailState {
  path: string;
  offset: number;
  partial: string;
  events: EventSummary[];
  lastEventAt?: number;
  inFlight?: boolean;
  lastCommand?: EventSummary;
  lastEdit?: EventSummary;
  lastMessage?: EventSummary;
  lastTool?: EventSummary;
  lastPrompt?: EventSummary;
  lastError?: EventSummary;
  model?: string;
}

let cachedSessions: SessionFile[] = [];
let lastSessionScan = 0;
const tailStates = new Map<string, TailState>();
const sessionIdCache = new Map<string, string | null>();
const sessionIdLastScan = new Map<string, number>();

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CONSENSUS_CODEX_HOME || env.CODEX_HOME;
  return override ? path.resolve(override) : path.join(os.homedir(), ".codex");
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
  const item = ev?.item || ev?.data?.item || ev?.delta?.item || ev?.message?.item;
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
    ev?.tool_name ||
    ev?.tool?.name ||
    ev?.tool;
  const toolTypes = new Set(["tool_call", "mcp_tool_call", "tool", "tool_execution"]);
  if (
    typeof toolName === "string" &&
    toolName.trim() &&
    (toolTypes.has(itemType || "") || /tool/i.test(type))
  ) {
    const summary = redactText(`tool: ${toolName.trim()}`) || `tool: ${toolName.trim()}`;
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

  const messageText =
    extractText(item?.content) ||
    extractText(item?.message) ||
    extractText(ev?.message) ||
    extractText(item?.text) ||
    extractText(ev?.text);
  if (messageText && itemType !== "reasoning") {
    const trimmed = messageText.replace(/\s+/g, " ").trim();
    if (trimmed) {
      const snippet = trimmed.slice(0, 80);
      const summary = redactText(snippet) || snippet;
      return { summary, kind: "message", isError, model, type };
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
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(sessionPath);
  } catch {
    return null;
  }

  const prev = tailStates.get(sessionPath);
  const state: TailState =
    prev ||
    ({
      path: sessionPath,
      offset: 0,
      partial: "",
      events: [],
    } as TailState);

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

  const startRe = /(turn|item|response)\.started/i;
  const endRe = /(turn|item|response)\.(completed|failed|errored)/i;
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = getEventTimestamp(ev);
    const { summary, kind, isError, model, type } = summarizeEvent(ev);
    if (model) state.model = model;
    if (typeof type === "string") {
      if (startRe.test(type)) state.inFlight = true;
      if (endRe.test(type)) state.inFlight = false;
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
      if (isError) state.lastError = entry;
      if (state.events.length > MAX_EVENTS) {
        state.events = state.events.slice(-MAX_EVENTS);
      }
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
  }

  state.offset = stat.size;
  tailStates.set(sessionPath, state);
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
    inFlight: state.inFlight,
  };
}
