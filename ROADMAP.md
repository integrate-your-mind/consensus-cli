# Roadmap

## Current direction: graphs and loops

Consensus is moving from a process atlas toward a local-first view of coding-agent execution graphs. It remains an observability product, not an orchestrator.

### Now

- Produce privacy-safe, turn-scoped graphs for Codex, OpenCode, and Claude Code.
- Keep loop state and counts semantically exact.
- Maintain bounded provider metadata and clear data-retention controls.
- Get full unit, integration, UI, and build checks green on supported platforms.

### Next

- Add explicit parent and child edges where provider contracts expose them.
  - OpenCode currently exposes `parentID` and `/session/:id/children`.
  - Claude hooks expose subagent and task lifecycle events.
- Stream graph deltas through the server.
- Render turn segments, edges, and loop state in the browser.
- Add traversal-aware loop iterations, duration, stop-rule status, and stuck-loop warnings.

### Later

- Compare declared workflow graphs with runtime-created task graphs.
- Add graph replay and run comparison.
- Add an optional multi-device relay while keeping local-only mode complete.
- Add compact graph grouping and performance profiling.

## Reliability work

- Improve process-to-session matching when providers expose stable metadata.
- Keep activity parsing stable across provider releases.
- Maintain Windows and shell-portable test and setup paths.
