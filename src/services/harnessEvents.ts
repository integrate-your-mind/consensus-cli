import type { HarnessId } from "../harnesses.js";
import {
  harnessHookEventKey,
  harnessHookEventSummary,
  type HookHarnessId,
  type NormalizedHarnessHookEvent,
} from "../harnessHookModel.js";
import type { EventSummary } from "../types.js";
import {
  flushHarnessEventPersistence,
  queueHarnessEventPersistence,
  readStoredHarnessEvents,
} from "./harnessEventLog.js";

const DEFAULT_RETENTION_MS = 30 * 60 * 1000;
const DEFAULT_INFLIGHT_TIMEOUT_MS = 30_000;
const MAX_EVENTS = 50;
const INFLIGHT_TYPES = new Set<NormalizedHarnessHookEvent["type"]>([
  "UserPromptSubmit",
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
]);
const IDLE_TYPES = new Set<NormalizedHarnessHookEvent["type"]>([
  "Stop",
  "StopFailure",
  "Interrupt",
  "SessionEnd",
]);
const ERROR_TYPES = new Set<NormalizedHarnessHookEvent["type"]>([
  "PostToolUseFailure",
  "StopFailure",
]);
const NON_ACTIVITY_TYPES = new Set<NormalizedHarnessHookEvent["type"]>([
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
  "Notification",
]);

export interface HarnessSessionState {
  harnessId: HookHarnessId;
  sessionKey: string;
  cwdKey?: string;
  inFlight: boolean;
  hasError: boolean;
  lastSeenAt: number;
  lastActivityAt?: number;
  lastEventType?: NormalizedHarnessHookEvent["type"];
  events: EventSummary[];
}

type StateMap = Map<string, HarnessSessionState>;
const stateBySession = new Map<string, HarnessSessionState>();

function stateKey(harnessId: HarnessId, sessionKey: string): string {
  return `${harnessId}:${sessionKey}`;
}

function retentionMs(): number {
  const parsed = Number(process.env.CONSENSUS_HARNESS_EVENT_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_RETENTION_MS;
}

function inFlightTimeoutMs(): number {
  const parsed = Number(process.env.CONSENSUS_HARNESS_INFLIGHT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_INFLIGHT_TIMEOUT_MS;
}

function eventSummaryKey(event: EventSummary): string {
  return JSON.stringify([
    event.ts,
    event.type,
    event.summary,
    event.isError === true,
    event.turnId ?? null,
  ]);
}

function mergeEvents(
  existing: EventSummary[],
  next: EventSummary | undefined
): EventSummary[] {
  if (!next) return existing;
  const seen = new Set<string>();
  return [...existing, next]
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      const key = eventSummaryKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.event.ts - b.event.ts || a.index - b.index)
    .slice(-MAX_EVENTS)
    .map(({ event }) => event);
}

function isActivityEvent(event: NormalizedHarnessHookEvent): boolean {
  if (event.type === "Notification") {
    return event.notificationType?.toLowerCase() !== "idle_prompt";
  }
  return !NON_ACTIVITY_TYPES.has(event.type);
}

function expireState(
  state: HarnessSessionState,
  now: number
): HarnessSessionState {
  if (!state.inFlight || typeof state.lastActivityAt !== "number") return state;
  return now - state.lastActivityAt > inFlightTimeoutMs()
    ? { ...state, inFlight: false }
    : state;
}

function pruneState(map: StateMap, now: number): StateMap {
  const cutoff = now - retentionMs();
  const next = new Map<string, HarnessSessionState>();
  for (const [key, state] of map) {
    if (state.lastSeenAt < cutoff) continue;
    next.set(key, expireState(state, now));
  }
  return next;
}

export function applyHarnessEvent(
  map: StateMap,
  event: NormalizedHarnessHookEvent
): StateMap {
  const key = stateKey(event.harnessId, event.sessionKey);
  const previous = map.get(key);
  const summary = harnessHookEventSummary(event);
  const events = mergeEvents(previous?.events ?? [], summary);

  if (previous && event.timestamp < previous.lastSeenAt) {
    const nextMap = new Map(map);
    nextMap.set(key, {
      ...previous,
      cwdKey: previous.cwdKey ?? event.cwdKey,
      events,
    });
    return nextMap;
  }

  const idleNotification =
    event.type === "Notification" &&
    event.notificationType?.toLowerCase() === "idle_prompt";
  const activity = isActivityEvent(event);
  const hasError = ERROR_TYPES.has(event.type)
    ? true
    : activity
      ? false
      : previous?.hasError ?? false;
  let inFlight = previous?.inFlight ?? false;
  if (INFLIGHT_TYPES.has(event.type)) inFlight = true;
  if (IDLE_TYPES.has(event.type) || idleNotification) inFlight = false;

  const nextState: HarnessSessionState = {
    harnessId: event.harnessId,
    sessionKey: event.sessionKey,
    cwdKey: event.cwdKey ?? previous?.cwdKey,
    inFlight,
    hasError,
    lastSeenAt: event.timestamp,
    lastActivityAt:
      IDLE_TYPES.has(event.type) || idleNotification
        ? undefined
        : activity
          ? event.timestamp
          : previous?.lastActivityAt,
    lastEventType: event.type,
    events,
  };
  const nextMap = new Map(map);
  nextMap.set(key, nextState);
  return nextMap;
}

function replaceState(next: StateMap): void {
  stateBySession.clear();
  for (const [key, value] of next) stateBySession.set(key, value);
}

export async function hydrateHarnessEventsFromDisk(): Promise<void> {
  const storedEvents = await readStoredHarnessEvents();
  let next = pruneState(new Map(stateBySession), Date.now());
  for (const event of storedEvents) next = applyHarnessEvent(next, event);
  replaceState(next);
}

export function handleNormalizedHarnessEvent(
  event: NormalizedHarnessHookEvent,
  persist = true
): void {
  const now = Math.max(Date.now(), event.timestamp);
  const next = applyHarnessEvent(pruneState(new Map(stateBySession), now), event);
  replaceState(next);
  if (persist) void queueHarnessEventPersistence(event);
}

export function getHarnessActivityBySession(
  harnessId: HookHarnessId,
  sessionKey: string,
  now: number = Date.now()
): HarnessSessionState | undefined {
  replaceState(pruneState(new Map(stateBySession), now));
  return stateBySession.get(stateKey(harnessId, sessionKey));
}

export function getHarnessActivityByCwd(
  harnessId: HookHarnessId,
  cwdKey: string,
  now: number = Date.now()
): HarnessSessionState | undefined {
  replaceState(pruneState(new Map(stateBySession), now));
  let best: HarnessSessionState | undefined;
  for (const state of stateBySession.values()) {
    if (state.harnessId !== harnessId || state.cwdKey !== cwdKey) continue;
    if (!best || state.lastSeenAt > best.lastSeenAt) best = state;
  }
  return best;
}

export function listHarnessActivity(
  harnessId: HookHarnessId,
  now: number = Date.now()
): HarnessSessionState[] {
  replaceState(pruneState(new Map(stateBySession), now));
  return [...stateBySession.values()]
    .filter((state) => state.harnessId === harnessId)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function resetHarnessActivityForTests(): void {
  stateBySession.clear();
}

export { flushHarnessEventPersistence, harnessHookEventKey };
