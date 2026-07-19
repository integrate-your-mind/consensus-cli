import {
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  MAX_HOOK_FUTURE_SKEW_MS,
  harnessHookEventKey,
  isHookHarnessId,
  type CanonicalHarnessHookType,
  type NormalizedHarnessHookEvent,
} from "../harnessHookModel.js";

const DEFAULT_LOG_MAX_BYTES = 2 * 1024 * 1024;
const MIN_LOG_MAX_BYTES = 64 * 1024;
const DEFAULT_RETENTION_MS = 30 * 60 * 1000;
const MAX_SEEN_EVENTS = 10_000;
const LOCK_WAIT_MS = 1_000;
const LOCK_RETRY_MS = 10;
const LOCK_STALE_MS = 30_000;
const DEDUP_TAIL_BYTES = 256 * 1024;
const KEY_RE = /^[a-f0-9]{24}$/;
const LABEL_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const CANONICAL_TYPES = new Set<CanonicalHarnessHookType>([
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "MessageDisplay",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionRequest",
  "PermissionResult",
  "PermissionDenied",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "PreVerify",
  "ErrorOccurred",
  "Stop",
  "StopFailure",
  "Interrupt",
  "PreCompact",
  "PostCompact",
  "Notification",
]);
const seenEvents = new Set<string>();
let seenPath: string | undefined;
let persistenceQueue: Promise<void> = Promise.resolve();

function resolveLogPath(): string | undefined {
  const configured = process.env.CONSENSUS_HARNESS_EVENT_LOG?.trim();
  if (configured) {
    const lowered = configured.toLowerCase();
    if (lowered === "0" || lowered === "false" || lowered === "off") {
      return undefined;
    }
    return path.resolve(configured);
  }
  return path.join(homedir(), ".consensus", "harness-events.jsonl");
}

function resolveLogMaxBytes(): number {
  const parsed = Number(process.env.CONSENSUS_HARNESS_EVENT_LOG_MAX_BYTES);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOG_MAX_BYTES;
  return Math.max(MIN_LOG_MAX_BYTES, Math.floor(parsed));
}

function resolveRetentionMs(): number {
  const parsed = Number(process.env.CONSENSUS_HARNESS_EVENT_TTL_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETENTION_MS;
  return Math.floor(parsed);
}

function useSeenPath(filePath: string): void {
  if (seenPath === filePath) return;
  seenEvents.clear();
  seenPath = filePath;
}

function rememberEvent(key: string): boolean {
  if (seenEvents.has(key)) return false;
  seenEvents.add(key);
  while (seenEvents.size > MAX_SEEN_EVENTS) {
    const oldest = seenEvents.values().next().value;
    if (typeof oldest !== "string") break;
    seenEvents.delete(oldest);
  }
  return true;
}

function newestCompleteLines(buffer: Buffer, keepBytes: number): Buffer {
  if (buffer.length <= keepBytes) return buffer;
  const tail = buffer.subarray(Math.max(0, buffer.length - keepBytes));
  const firstNewline = tail.indexOf(0x0a);
  return firstNewline >= 0 ? tail.subarray(firstNewline + 1) : Buffer.alloc(0);
}

async function trimLog(filePath: string, maxBytes: number): Promise<void> {
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

async function removeStaleLock(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs <= LOCK_STALE_MS) return false;
    await unlink(lockPath);
    return true;
  } catch {
    return true;
  }
}

async function withLogLock<T>(
  filePath: string,
  action: () => Promise<T>
): Promise<T> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        return await action();
      } finally {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (await removeStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`timed out acquiring harness event log lock: ${lockPath}`);
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

function isSafeLabel(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.length <= 160 &&
      !LABEL_CONTROL_RE.test(value))
  );
}

export function isStoredHarnessHookEvent(
  value: unknown
): value is NormalizedHarnessHookEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event.version === 1 &&
    isHookHarnessId(event.harnessId) &&
    typeof event.type === "string" &&
    CANONICAL_TYPES.has(event.type as CanonicalHarnessHookType) &&
    typeof event.sessionKey === "string" &&
    KEY_RE.test(event.sessionKey) &&
    typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp) &&
    event.timestamp >= 0 &&
    (event.cwdKey === undefined ||
      (typeof event.cwdKey === "string" && KEY_RE.test(event.cwdKey))) &&
    (event.turnKey === undefined ||
      (typeof event.turnKey === "string" && KEY_RE.test(event.turnKey))) &&
    isSafeLabel(event.toolName) &&
    isSafeLabel(event.agentType) &&
    isSafeLabel(event.notificationType) &&
    (event.final === undefined || typeof event.final === "boolean")
  );
}

async function tailContainsEventKey(
  filePath: string,
  key: string
): Promise<boolean> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (info.size <= 0) return false;

  const bytesToRead = Math.min(info.size, DEDUP_TAIL_BYTES);
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const position = Math.max(0, info.size - bytesToRead);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      bytesToRead,
      position
    );
    let input = buffer.subarray(0, bytesRead).toString("utf8");
    if (position > 0) {
      const firstNewline = input.indexOf("\n");
      input = firstNewline >= 0 ? input.slice(firstNewline + 1) : "";
    }
    for (const line of input.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          isStoredHarnessHookEvent(parsed) &&
          harnessHookEventKey(parsed) === key
        ) {
          return true;
        }
      } catch {
        // Ignore malformed or partially written lines.
      }
    }
    return false;
  } finally {
    await handle.close();
  }
}

async function persistEvent(
  filePath: string,
  event: NormalizedHarnessHookEvent,
  key: string
): Promise<void> {
  await withLogLock(filePath, async () => {
    if (await tailContainsEventKey(filePath, key)) return;
    await appendFile(filePath, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(filePath, 0o600).catch(() => undefined);
    await trimLog(filePath, resolveLogMaxBytes());
  });
}

export function queueHarnessEventPersistence(
  event: NormalizedHarnessHookEvent
): Promise<void> {
  const filePath = resolveLogPath();
  if (!filePath || !isStoredHarnessHookEvent(event)) return persistenceQueue;
  useSeenPath(filePath);
  const key = harnessHookEventKey(event);
  if (!rememberEvent(key)) return persistenceQueue;

  persistenceQueue = persistenceQueue
    .then(() => persistEvent(filePath, event, key))
    .catch(() => {
      if (seenPath === filePath) seenEvents.delete(key);
    });
  return persistenceQueue;
}

export function flushHarnessEventPersistence(): Promise<void> {
  return persistenceQueue;
}

async function readLogText(filePath: string): Promise<string> {
  const maxReadBytes = Math.max(
    DEFAULT_LOG_MAX_BYTES * 2,
    resolveLogMaxBytes() * 2
  );
  const info = await stat(filePath);
  if (info.size <= maxReadBytes) return readFile(filePath, "utf8");

  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxReadBytes);
    const position = Math.max(0, info.size - maxReadBytes);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      maxReadBytes,
      position
    );
    const tail = buffer.subarray(0, bytesRead);
    const firstNewline = tail.indexOf(0x0a);
    if (firstNewline < 0) return "";
    return tail.subarray(firstNewline + 1).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function readStoredHarnessEvents(): Promise<
  NormalizedHarnessHookEvent[]
> {
  const filePath = resolveLogPath();
  if (!filePath) return [];
  useSeenPath(filePath);

  let input: string;
  try {
    input = await readLogText(filePath);
  } catch {
    return [];
  }

  const now = Date.now();
  const cutoff = now - resolveRetentionMs();
  const latestAcceptedAt = now + MAX_HOOK_FUTURE_SKEW_MS;
  const events: NormalizedHarnessHookEvent[] = [];
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        !isStoredHarnessHookEvent(parsed) ||
        parsed.timestamp < cutoff ||
        parsed.timestamp > latestAcceptedAt
      ) {
        continue;
      }
      events.push(parsed);
    } catch {
      // Ignore malformed and partially written lines.
    }
  }
  events.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      harnessHookEventKey(a).localeCompare(harnessHookEventKey(b))
  );

  const result: NormalizedHarnessHookEvent[] = [];
  for (const event of events) {
    const key = harnessHookEventKey(event);
    if (!rememberEvent(key)) continue;
    result.push(event);
  }
  return result;
}
