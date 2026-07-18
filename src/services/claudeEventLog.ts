import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "fs/promises";
import { homedir } from "os";
import path from "path";
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
let persistenceQueue: Promise<void> = Promise.resolve();

function rememberStoredEvent(key: string): void {
  if (seenStoredEvents.has(key)) return;
  seenStoredEvents.add(key);
  while (seenStoredEvents.size > MAX_SEEN_STORED_EVENTS) {
    const oldest = seenStoredEvents.values().next().value;
    if (typeof oldest !== "string") break;
    seenStoredEvents.delete(oldest);
  }
}

function resolveEventLogPath(): string | undefined {
  const configured = process.env.CONSENSUS_CLAUDE_EVENT_LOG?.trim();
  if (configured) {
    const lowered = configured.toLowerCase();
    if (lowered === "0" || lowered === "false" || lowered === "off") {
      return undefined;
    }
    return configured;
  }
  return path.join(homedir(), ".consensus", "claude-events.jsonl");
}

function resolveEventLogMaxBytes(): number {
  const parsed = Number(process.env.CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EVENT_LOG_MAX_BYTES;
  return Math.max(64 * 1024, Math.floor(parsed));
}

async function trimEventLog(filePath: string, maxBytes: number): Promise<void> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return;
  }
  if (info.size <= maxBytes) return;

  const content = await readFile(filePath, "utf8");
  const keepCharacters = Math.max(32 * 1024, Math.floor(maxBytes / 2));
  let trimmed = content.slice(-keepCharacters);
  if (trimmed.length < content.length) {
    const firstNewline = trimmed.indexOf("\n");
    if (firstNewline >= 0) trimmed = trimmed.slice(firstNewline + 1);
  }
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  await writeFile(tempPath, trimmed, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
  await chmod(filePath, 0o600).catch(() => undefined);
}

async function persistStoredEvent(event: StoredClaudeEvent): Promise<void> {
  const filePath = resolveEventLogPath();
  if (!filePath) return;
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
  if (!stored) return persistenceQueue;
  const key = storedClaudeEventKey(stored);
  rememberStoredEvent(key);
  persistenceQueue = persistenceQueue
    .then(() => persistStoredEvent(stored))
    .catch(() => undefined);
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
    if (seenStoredEvents.has(key)) continue;
    rememberStoredEvent(key);
    result.push({ event: fromStoredClaudeEvent(stored), cwdKey: stored.cwdKey });
  }
  return result;
}
