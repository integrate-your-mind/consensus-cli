import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ClaudeEvent } from "../claude/types.js";
import {
  CLAUDE_STALE_TTL_MS,
  fromStoredClaudeEvent,
  isStoredClaudeEvent,
  storedClaudeEventKey,
  toStoredClaudeEvent,
  type StoredClaudeEvent,
} from "./claudeEventModel.js";

const DEFAULT_EVENT_LOG_MAX_BYTES = 1024 * 1024;
const MAX_SEEN_STORED_EVENTS = 5000;
const seenStoredEvents = new Set<string>();
let seenEventLogPath: string | undefined;
let persistenceQueue: Promise<void> = Promise.resolve();

function useSeenEventLogPath(filePath: string): void {
  if (seenEventLogPath === filePath) return;
  seenStoredEvents.clear();
  seenEventLogPath = filePath;
}

function rememberStoredEvent(key: string): boolean {
  if (seenStoredEvents.has(key)) return false;
  seenStoredEvents.add(key);
  while (seenStoredEvents.size > MAX_SEEN_STORED_EVENTS) {
    const oldest = seenStoredEvents.values().next().value;
    if (typeof oldest !== "string") break;
    seenStoredEvents.delete(oldest);
  }
  return true;
}

function resolveEventLogPath(): string | undefined {
  const configured = process.env.CONSENSUS_CLAUDE_EVENT_LOG?.trim();
  if (configured) {
    const lowered = configured.toLowerCase();
    if (lowered === "0" || lowered === "false" || lowered === "off") {
      return undefined;
    }
    return path.resolve(configured);
  }
  return path.join(homedir(), ".consensus", "claude-events.jsonl");
}

function resolveEventLogMaxBytes(): number {
  const parsed = Number(process.env.CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EVENT_LOG_MAX_BYTES;
  return Math.max(64 * 1024, Math.floor(parsed));
}

function newestCompleteLines(buffer: Buffer, keepBytes: number): Buffer {
  if (buffer.length <= keepBytes) return buffer;
  const tail = buffer.subarray(Math.max(0, buffer.length - keepBytes));
  const firstNewline = tail.indexOf(0x0a);
  return firstNewline >= 0 ? tail.subarray(firstNewline + 1) : Buffer.alloc(0);
}

async function trimEventLog(filePath: string, maxBytes: number): Promise<void> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return;
  }
  if (info.size <= maxBytes) return;

  const content = await readFile(filePath);
  const keepBytes = Math.max(32 * 1024, Math.floor(maxBytes / 2));
  const trimmed = newestCompleteLines(content, keepBytes);
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  await writeFile(tempPath, trimmed, { mode: 0o600 });
  await rename(tempPath, filePath);
  await chmod(filePath, 0o600).catch(() => undefined);
}

async function persistStoredEvent(
  filePath: string,
  event: StoredClaudeEvent
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600).catch(() => undefined);
  await trimEventLog(filePath, resolveEventLogMaxBytes());
}

export function queueClaudeEventPersistence(event: ClaudeEvent): Promise<void> {
  const stored = toStoredClaudeEvent(event);
  const filePath = resolveEventLogPath();
  if (!stored || !filePath) return persistenceQueue;

  useSeenEventLogPath(filePath);
  const key = storedClaudeEventKey(stored);
  if (!rememberStoredEvent(key)) return persistenceQueue;

  persistenceQueue = persistenceQueue
    .then(() => persistStoredEvent(filePath, stored))
    .catch(() => {
      if (seenEventLogPath === filePath) seenStoredEvents.delete(key);
    });
  return persistenceQueue;
}

export function flushClaudeEventPersistence(): Promise<void> {
  return persistenceQueue;
}

export async function readStoredClaudeEvents(): Promise<
  Array<{ event: ClaudeEvent; cwdKey?: string }>
> {
  const filePath = resolveEventLogPath();
  if (!filePath) return [];
  useSeenEventLogPath(filePath);

  let input: string;
  try {
    input = await readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const cutoff = Date.now() - CLAUDE_STALE_TTL_MS;
  const storedEvents: StoredClaudeEvent[] = [];
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isStoredClaudeEvent(parsed) || parsed.timestamp < cutoff) continue;
      storedEvents.push(parsed);
    } catch {
      // Ignore malformed or partially written lines.
    }
  }
  storedEvents.sort((a, b) => a.timestamp - b.timestamp);

  const result: Array<{ event: ClaudeEvent; cwdKey?: string }> = [];
  for (const stored of storedEvents) {
    const key = storedClaudeEventKey(stored);
    if (!rememberStoredEvent(key)) continue;
    result.push({ event: fromStoredClaudeEvent(stored), cwdKey: stored.cwdKey });
  }
  return result;
}
