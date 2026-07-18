import { Effect, Ref, pipe } from "effect";
import type { ClaudeEvent, ClaudeSessionState } from "../claude/types.js";
import {
  applyClaudeEvent,
  pruneClaudeState,
  stableClaudePathKey,
  type ClaudeStateMap,
} from "./claudeEventModel.js";
import {
  flushClaudeEventPersistence,
  queueClaudeEventPersistence,
  readStoredClaudeEvents,
} from "./claudeEventLog.js";

const stateRef = Effect.runSync(Ref.make(new Map<string, ClaudeSessionState>()));

export async function hydrateClaudeEventsFromDisk(): Promise<void> {
  const storedEvents = await readStoredClaudeEvents();
  Effect.runSync(
    Ref.update(stateRef, (map) => {
      let next = pruneClaudeState(map, Date.now());
      for (const stored of storedEvents) {
        next = applyClaudeEvent(next, stored.event, stored.cwdKey);
      }
      return next;
    })
  );
}

export { flushClaudeEventPersistence };

function updateClaudeEventState(event: ClaudeEvent): Effect.Effect<void> {
  return Ref.update(stateRef, (map) => {
    const now = typeof event.timestamp === "number" ? event.timestamp : Date.now();
    return applyClaudeEvent(pruneClaudeState(map, now), event);
  });
}

export const handleClaudeEventEffect = (event: ClaudeEvent): Effect.Effect<void> =>
  pipe(
    updateClaudeEventState(event),
    Effect.flatMap(() => {
      void queueClaudeEventPersistence(event);
      return Effect.succeed(undefined as void);
    }),
    Effect.catchAll(() => Effect.succeed(undefined as void))
  );

export const getClaudeActivityBySessionEffect = (
  sessionId: string,
  now: number = Date.now()
): Effect.Effect<ClaudeSessionState | undefined> =>
  Ref.modify(stateRef, (map) => {
    const pruned = pruneClaudeState(map, now);
    return [pruned.get(sessionId), pruned];
  });

export const getClaudeActivityByCwdEffect = (
  cwd: string,
  now: number = Date.now()
): Effect.Effect<ClaudeSessionState | undefined> =>
  Ref.modify(stateRef, (map) => {
    if (!cwd) return [undefined, map];
    const pruned = pruneClaudeState(map, now);
    const cwdKey = stableClaudePathKey(cwd);
    let best: ClaudeSessionState | undefined;
    let bestAt = 0;
    for (const state of pruned.values()) {
      if (state.cwd !== cwd && (!cwdKey || state.cwdKey !== cwdKey)) continue;
      const candidateAt = state.lastActivityAt ?? state.lastSeenAt ?? 0;
      if (!best || candidateAt > bestAt) {
        best = state;
        bestAt = candidateAt;
      }
    }
    return [best, pruned];
  });

// Sync wrappers for non-Effect code paths and tests. The HTTP path uses the
// Effect handler above, which also queues bounded metadata persistence.
export function handleClaudeEvent(event: ClaudeEvent): void {
  Effect.runSync(updateClaudeEventState(event));
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
