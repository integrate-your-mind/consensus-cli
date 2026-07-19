# Codex Tail State Transitions (`updateTailLegacy`)

This document records the effective state machine implemented by `updateTailLegacy` (`src/codexLogs.ts`) for Codex session JSONL tails.

## State Fields (focus)

- `inFlight` (boolean)
  - "Hard" in-flight flag set by start/activity signals and cleared only by expiration or `finalizeEnd`.
- `turnOpen` (boolean)
  - Whether a turn/response is considered open. Suppresses stale expiration when true.
- `pendingEndAt` (number ms timestamp)
  - End marker observed (response/turn completed, review exit). Used to delay finalization.
- `reviewMode` (boolean)
  - Entered/exited via `entered_review_mode` / `exited_review_mode` payload types.
- `openCallIds` (`Set<string>`) and `openItemCount` (number)
  - Tracks open tool/item work. Any non-zero "open call count" prevents expiration.

## Computed Summary (`summarizeTail`)

`summarizeTail` treats a session as in-flight if *any* of the following are true:

- `state.inFlight`
- `state.reviewMode`
- `openCallCount > 0` (`openCallIds.size + openItemCount`)
- `pendingEndAt` is set
- `turnOpen` is true

This means `summary.inFlight` can remain true even when `state.inFlight` is false (for example, while `pendingEndAt` is set).

## Transition Table

Each row describes: trigger, conditions, and how it mutates `inFlight`, `turnOpen`, `pendingEndAt`, `reviewMode`, and open-call tracking.

| Trigger | Condition | State Changes |
|---|---|---|
| File missing | `stat()` throws | Returns `null` (no state). |
| File stale | `now - mtimeMs > CONSENSUS_CODEX_STALE_FILE_MS` and `keepStale=false` | Clears `inFlight`, `turnOpen`, `reviewMode`, `pendingEndAt`, `lastEndAt`, open-call tracking; clears activity timestamps. |
| File truncated | `stat.size < state.offset` | Resets offset/partial/events/summary fields; clears `inFlight`, `turnOpen`, `reviewMode`, `pendingEndAt`, open-call tracking. |
| Turn start | `type/payload` includes `turn.started` or `thread.started` | `turnOpen=true`; `pendingEndAt` cleared; if signal is fresh: `inFlight=true`, `inFlightStart=true`, `lastInFlightSignalAt=now`; `lastActivityAt=max(lastActivityAt, ts)`. |
| Response start | `turn.started` or `response.started` or `*.running` | Same as turn start. |
| Response delta | response delta type | `turnOpen=true`; clears end markers; if fresh: `inFlight=true`, `inFlightStart=true`, mark signal; bumps `lastActivityAt`. |
| Work item started | `item.started` and `item.type` in work types | Clears end markers; adds `callId/itemId` to `openCallIds` or increments `openItemCount`; if fresh: `turnOpen=true`, `inFlight=true`; bumps `lastActivityAt`. |
| Work item ended | `item.completed` or terminal status for work types | Removes `callId/itemId` from `openCallIds` or decrements `openItemCount` best-effort. |
| Tool call start (`response_item`) | payload type indicates function/tool call (not output) | Adds `callId` to `openCallIds` or increments `openItemCount`; clears end markers; if fresh: `turnOpen=true`, `inFlight=true`; bumps `lastActivityAt`; records `lastToolSignalAt`. |
| Tool output (`response_item`) | payload type indicates `*_call_output` | Removes a matching `callId` (or best-effort closes one); bumps `lastActivityAt`; records `lastToolSignalAt`. Does not clear end markers directly. |
| Review enter | payload type `entered_review_mode` | `reviewMode=true`; `turnOpen=true`; clears end markers; `inFlight=true`; bumps `lastActivityAt`. |
| Review exit | payload type `exited_review_mode` | `reviewMode=false`; `pendingEndAt=max(pendingEndAt, ts)`; `turnOpen=false`; bumps `lastActivityAt`. |
| Turn abort | item type includes `turn_aborted` | `pendingEndAt=max(pendingEndAt, ts)`; `turnOpen=false`. |
| Turn end | `turn.completed|failed|...` | `pendingEndAt=max(pendingEndAt, ts)`; `turnOpen=false`. |
| Response end | `response.completed|failed|...` | `pendingEndAt=max(pendingEndAt, ts)`; `turnOpen=false`. |

## Expiration Logic (`expireInFlight`)

`expireInFlight()` runs on every `updateTailLegacy` call, including when no new bytes were read.

### Pending End Path

If `pendingEndAt` is set:

1. If `openCallCount > 0`, do nothing.
2. If a later activity timestamp exists (`lastToolSignalAt` or `lastActivityAt` or `lastEventAt` greater than `pendingEndAt`), cancel the pending end (`pendingEndAt` cleared).
3. Else, if `now - pendingEndAt >= CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS`, finalize:
   - `inFlight=false`, `turnOpen=false`, `pendingEndAt=undefined`, `lastEndAt=pendingEndAt`
   - clears `lastInFlightSignalAt`, `lastIngestAt`
   - clears open-call tracking

### Stale In-Flight Path

If `pendingEndAt` is not set:

1. If `reviewMode=true`, do nothing.
2. If `turnOpen=true`, do nothing (explicitly suppresses stale expiration).
3. If `openCallCount > 0`, do nothing.
4. If `lastEndAt` is set, clears `inFlight` and activity markers.
5. Else, if `now - lastSignal >= CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS`, expire:
   - `inFlight=false`, `turnOpen=false`, `pendingEndAt=undefined`, `lastEndAt=now`
   - clears activity markers and open-call tracking.

## Findings (Unreachable/Contradictory States)

- `reviewMode=true` is sticky without an explicit `exited_review_mode` event. While in `reviewMode`, stale expiration is suppressed, so the session can remain in-flight indefinitely until a review-exit event or file reset occurs.
- `openCallIds/openItemCount` are sticky if corresponding end/output events are missed. Any open-call count prevents both pending-end and stale expiration. This is consistent with the "if unsure, stay active" policy, but it can also create ghost activity if logs are incomplete.
- A single `turn.started` event can match both the explicit "turn start" branch and the "response start" regex branch. This is redundant but not contradictory (both branches set the same state).

