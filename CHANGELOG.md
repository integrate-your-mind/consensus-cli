# Changelog

All notable changes to this project will be documented in this file.
This project follows Semantic Versioning.

## Unreleased
- Fix: normalize OpenCode detection for mixed-case binary paths to keep servers in the correct lane.
- Fix: OpenCode activity now uses work-only timestamps (not heartbeat events) and decays in-flight after idle.
- Fix: Claude CLI prompts use a short pulse instead of sticking active indefinitely.
- Fix: prevent OpenCode “server” misclassification when prompts include “server” text (tokenized subcommand parsing).
- Fix: reduce OpenCode server idle flicker with a higher CPU threshold for servers.
- Fix: avoid Codex in-flight flicker by clearing on explicit assistant completion (tool call tracking + assistant message end).
- Fix: remove short in-flight idle clearing by default (configurable via `CONSENSUS_CODEX_INFLIGHT_IDLE_MS`).
- Fix: stabilize Codex activation with prompt pulse + file-growth activity and longer event/hold defaults.
- Fix: Codex prompt pulse for instant activation without waiting on streaming events.
- Fix: ignore OpenCode helper processes without sessions to avoid false active tiles.
- Fix: reduce OpenCode active/hold defaults for faster idle transitions.
- Fix Codex session matching by using `session_meta` cwd when session IDs are missing.
- Add sustained CPU fallback for Codex active detection when log signals lag.
- Use OpenCode API/storage activity timestamps to reduce activation lag.
- Harden WebSocket override handling for UI tests.
- Switch to event-driven updates (Codex log watch + OpenCode SSE) with slow PID polling.
- Surface OpenCode API failures in the UI status line.
- Do not treat Codex prompts as activity (avoid false active state).
- Deduplicate by PID to avoid hiding live agents when session association drifts.
- Cache process/session scans for fast event-driven refreshes.
- Expand Codex in-flight detection for response created/delta events.
- Reduce Codex idle lag by shortening default active + hold windows.
- Clear Codex in-flight state when activity is stale.
- Fix: keep Codex in-flight active until timeout to prevent active/idle flicker mid-run.
- Parallelize Codex tail reads to reduce pickup lag.
- Lower Codex active windows for sub-second idle transitions.

## 0.1.6 - 2026-01-25
- Treat Codex response items as activity only for assistant output/tool work (not user prompts).
- Reduce false active state by using activity timestamps instead of generic event timestamps.

## 0.1.5 - 2026-01-25
- Add Claude Code process detection with prompt/resume parsing.
- Apply CLI-specific palettes (Codex/OpenCode/Claude Code) across tiles and lane items.
- Add Claude CLI parsing unit tests.
- Update README with Claude Code support.

## 0.1.4 - 2026-01-24
- Fix OpenCode event tracking build error (pid activity typing).

## 0.1.3 - 2026-01-24
- Add OpenCode integration (API sessions, event stream, storage fallback).
- Autostart OpenCode server with opt-out and CLI flags.
- Split servers into a dedicated lane with distinct palette.
- Improve layout keys to prevent tile overlap.
- Add OpenCode unit/integration tests and configuration docs.

## 0.1.2 - 2026-01-24
- Lower CPU threshold for active detection.
- Increase activity window defaults for long-running turns.
- Skip vendor codex helper processes to avoid duplicate tiles.
- Improve session mapping for active-state detection.

## 0.1.1 - 2026-01-24
- Smooth active state to prevent animation flicker.
- Add `consensus-cli` binary alias so `npx consensus-cli` works.
- Extend active window to match Codex event cadence.

## 0.1.0 - 2026-01-24
- Initial public release.
- Improve work summaries and recent events (latest-first, event-only fallback).
- Mark agents active based on recent events (not just CPU).
- License: Apache-2.0.
