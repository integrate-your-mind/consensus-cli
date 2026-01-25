# Changelog

All notable changes to this project will be documented in this file.
This project follows Semantic Versioning.

## Unreleased

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
