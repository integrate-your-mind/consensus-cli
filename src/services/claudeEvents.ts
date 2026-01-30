import { Effect, Ref } from "effect";
import type { ClaudeEvent, ClaudeSessionState } from "../claude/types.js";

const STALE_TTL_MS = Number(process.env.CONSENSUS_CLAUDE_EVENT_TTL_MS || 30 * 60 * 1000);
const INFLIGHT_TIMEOUT_MS = Number(
  process.env.CONSENSUS_CLAUDE_INFLIGHT_TIMEOUT_MS || 15000
);

const INFLIGHT_EVENTS = new Set<string>([
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
]);

const IDLE_EVENTS = new Set<string>(["Stop", "SubagentStop", "SessionEnd"]);
const NON_ACTIVITY_EVENTS = new Set<string>(["SessionStart", ...IDLE_EVENTS]);

type StateMap = Map<string, ClaudeSessionState>;

const stateRef = Effect.runSync(Ref.make(new Map<string, ClaudeSessionState>()));

function normalizeType(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const key = trimmed.replace(/[^a-z0-9]/gi, "").toLowerCase();
  switch (key) {
    case "userpromptsubmit":
      return "UserPromptSubmit";
    case "pretooluse":
      return "PreToolUse";
    case "posttooluse":
      return "PostToolUse";
    case "posttoolusefailure":
      return "PostToolUseFailure";
    case "permissionrequest":
      return "PermissionRequest";
    case "subagentstart":
      return "SubagentStart";
    case "subagentstop":
      return "SubagentStop";
    case "sessionstart":
      return "SessionStart";
    case "sessionend":
      return "SessionEnd";
    case "stop":
      return "Stop";
    case "notification":
      return "Notification";
    default:
      return trimmed;
  }
}

function isActivityEvent(type: string): boolean {
  if (!type) return false;
  return !NON_ACTIVITY_EVENTS.has(type);
}

function expireInFlight(state: ClaudeSessionState, now: number): ClaudeSessionState {
  if (!state.inFlight) return state;
  const lastSignal = state.lastActivityAt ?? state.lastSeenAt;
  if (typeof lastSignal === "number" && now - lastSignal > INFLIGHT_TIMEOUT_MS) {
    return { ...state, inFlight: false };
  }
  return state;
}

function pruneStale(map: StateMap, now: number): StateMap {
  let changed = false;
  const next = new Map<string, ClaudeSessionState>();
  for (const [sessionId, state] of map.entries()) {
    if (now - state.lastSeenAt > STALE_TTL_MS) {
      changed = true;
      continue;
    }
    const updated = expireInFlight(state, now);
    if (updated !== state) changed = true;
    next.set(sessionId, updated);
  }
  return changed ? next : map;
}

function applyEvent(map: StateMap, event: ClaudeEvent): StateMap {
  const now = typeof event.timestamp === "number" ? event.timestamp : Date.now();
  const type = normalizeType(event.type);
  const notificationType = event.notificationType?.trim();
  const isIdleNotification =
    type === "Notification" && notificationType?.toLowerCase() === "idle_prompt";
  const prev = map.get(event.sessionId);
  const next: ClaudeSessionState = {
    sessionId: event.sessionId,
    inFlight: prev?.inFlight ?? false,
    lastSeenAt: now,
    cwd: event.cwd ?? prev?.cwd,
    transcriptPath: event.transcriptPath ?? prev?.transcriptPath,
    lastEvent: type,
    lastActivityAt: prev?.lastActivityAt,
  };
  if (INFLIGHT_EVENTS.has(type)) next.inFlight = true;
  if (IDLE_EVENTS.has(type) || isIdleNotification) {
    next.inFlight = false;
    next.lastActivityAt = undefined;
  } else if (isActivityEvent(type)) {
    next.lastActivityAt = now;
  }
  const nextMap = new Map(map);
  nextMap.set(event.sessionId, next);
  return nextMap;
}

export const handleClaudeEventEffect = (event: ClaudeEvent): Effect.Effect<void> =>
  Ref.update(stateRef, (map) => {
    const now = typeof event.timestamp === "number" ? event.timestamp : Date.now();
    const pruned = pruneStale(map, now);
    return applyEvent(pruned, event);
  });

export const getClaudeActivityBySessionEffect = (
  sessionId: string,
  now: number = Date.now()
): Effect.Effect<ClaudeSessionState | undefined> =>
  Ref.modify(stateRef, (map) => {
    const pruned = pruneStale(map, now);
    return [pruned.get(sessionId), pruned];
  });

export const getClaudeActivityByCwdEffect = (
  cwd: string,
  now: number = Date.now()
): Effect.Effect<ClaudeSessionState | undefined> =>
  Ref.modify(stateRef, (map) => {
    if (!cwd) return [undefined, map];
    const pruned = pruneStale(map, now);
    let best: ClaudeSessionState | undefined;
    let bestAt = 0;
    for (const state of pruned.values()) {
      if (!state.cwd || state.cwd !== cwd) continue;
      const candidateAt = state.lastActivityAt ?? state.lastSeenAt ?? 0;
      if (!best || candidateAt > bestAt) {
        best = state;
        bestAt = candidateAt;
      }
    }
    return [best, pruned];
  });

// Sync wrappers for non-Effect code paths (scan.ts/tests).
export function handleClaudeEvent(event: ClaudeEvent): void {
  Effect.runSync(handleClaudeEventEffect(event));
}

export function getClaudeActivityBySession(
  sessionId: string,
  now: number = Date.now()
): ClaudeSessionState | undefined {
  return Effect.runSync(getClaudeActivityBySessionEffect(sessionId, now));
}

export function getClaudeActivityByCwd(
  cwd: string,
  now: number = Date.now()
): ClaudeSessionState | undefined {
  return Effect.runSync(getClaudeActivityByCwdEffect(cwd, now));
}
