# Changelog

All notable changes to this project will be documented in this file.
This project follows Semantic Versioning.

## Unreleased

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
