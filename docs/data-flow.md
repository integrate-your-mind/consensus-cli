# Codex JSONL Data Flow

This document describes how Codex activity becomes a Consensus snapshot.

## Writers: Codex CLI session logs

- Writer: the Codex CLI (`codex`) writes append-only JSON Lines (`*.jsonl`) session logs.
- Default location: `~/.codex/sessions/**.jsonl` (often bucketed by date, e.g. `~/.codex/sessions/2026/02/03/rollout-...jsonl`).
- Config: the base directory is resolved from `CONSENSUS_CODEX_HOME` (and falls back to `CODEX_HOME`) by `resolveCodexHome` in `src/codexLogs.ts`.

## Readers: Consensus tailer (`updateTail`)

- Reader: Consensus maps running Codex processes to session JSONL files in `scanCodexProcesses` (`src/scan.ts`).
- Tailer: selected session files are tailed and parsed by `updateTail(...)` in `src/codexLogs.ts`.
- State held per file: `updateTail` maintains a per-path tail state (byte offset, partial line buffer, parsed events, `lastActivityAt`, `inFlight`, etc.) that is summarized via `summarizeTail(...)` for snapshots.

## Webhook: `/api/codex-event` is a trigger only

- Endpoint: `POST /api/codex-event` in `src/server.ts`.
- Role: validates the incoming webhook payload and triggers a fast scan (`requestTick("fast")`).
- Non-role: it does not merge webhook payloads into agent/session state. State still comes from JSONL tails.

## Notify log: `codex-notify.jsonl` (append-only)

- Writer: `src/codexNotify.ts` appends the raw notify payload (one JSON object per line) to:
  - `~/.codex/consensus/codex-notify.jsonl`
- Reader: Consensus reads the tail of this file opportunistically (see `hydrateTailNotify(...)` and `loadNotifyEvents(...)` in `src/codexLogs.ts`) to attach recent notify timestamps to the current thread/turn.
- Scope: this is supplemental metadata; it does not replace session JSONL as the activity authority.

## Session pinning: PID to session path cache

Session selection is heuristic (session id in the command line, open `*.jsonl` paths from `lsof`, cwd matching). To prevent oscillation across scan ticks, Consensus pins the chosen mapping:

- Cache: `pidSessionCache` in `src/scan.ts` stores `pid -> { path, startMs, lastSeenAt }`.
- Stale release: pinned entries are released when:
  - the PID start time changes (PID reuse/restart),
  - the pinned file disappears, or
  - the pinned file's mtime is older than `CONSENSUS_CODEX_STALE_FILE_MS` (defaults documented in `docs/configuration.md`).

## Single source of truth (SSOT)

Consensus treats the session JSONL tail as authoritative:

- Authority: `summarizeTail(...)` in `src/codexLogs.ts` is the source of truth for `inFlight` and `lastActivityAt`.
- Consumer: `src/scan.ts` derives Codex agent state from `inFlight` and `lastActivityAt` (plus hold/idle windows). No other signal is allowed to override JSONL tail state.

