# Changelog

All notable changes to this project will be documented in this file.
This project follows Semantic Versioning.

## Unreleased

- Add: `consensus graph` builds a versioned, provider-neutral execution graph from retained events.
- Add: turn-scoped step nodes and lifecycle filtering prevent ordinary multi-turn sessions from appearing as loops.
- Add: bounded metadata-only Claude hook history for one-shot scan and graph inspection.
- Add: current Claude hook coverage for `MessageDisplay`, `PostToolBatch`, `PermissionDenied`, task events, and `StopFailure`.
- Fix: treat `UserPromptSubmit` as the sole retained Claude turn boundary so slash-command expansion does not create a duplicate turn.
- Fix: graph IDs use opaque agent keys instead of reversible raw session paths.
- Fix: historical loops no longer inherit an agent's unrelated current state.
- Fix: live graph inspection disables OpenCode server autostart.
- Fix: loop edge evidence is named `transitionObservations` rather than implied iteration count.
- Fix: graph snapshot input now rejects malformed agents, provider kinds, states, and events.
- Fix: normalize OpenCode detection for mixed-case binary paths to keep servers in the correct lane.
- Fix: OpenCode activity uses work-only timestamps and decays stale in-flight state.
- Fix: Claude CLI prompts use a short pulse instead of sticking active indefinitely.
- Fix: prevent OpenCode server misclassification when prompts include server text.
- Fix: reduce OpenCode server idle flicker with a higher CPU threshold.
- Fix: stabilize Codex in-flight activity across tool calls and assistant completion.
- Fix: improve Codex session matching, event-driven updates, and bounded caches.

## 0.1.6 - 2026-01-25

- Treat Codex response items as activity only for assistant output and tool work.
- Reduce false active state by using activity timestamps instead of generic event timestamps.

## 0.1.5 - 2026-01-25

- Add Claude Code process detection with prompt and resume parsing.
- Apply provider palettes across tiles and lane items.
- Add Claude CLI parsing tests.

## 0.1.4 - 2026-01-24

- Fix OpenCode event tracking build error.

## 0.1.3 - 2026-01-24

- Add OpenCode sessions, event stream, and storage fallback.
- Add optional OpenCode server autostart.
- Split servers into a dedicated lane.

## 0.1.2 - 2026-01-24

- Improve activity thresholds and session mapping.
- Skip duplicate Codex vendor helper processes.

## 0.1.1 - 2026-01-24

- Smooth active-state rendering.
- Add the `consensus-cli` binary alias.

## 0.1.0 - 2026-01-24

- Initial public release under Apache-2.0.
