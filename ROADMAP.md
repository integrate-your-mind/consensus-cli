# Roadmap

## Current direction: graphs and loops

Consensus is moving from a process atlas toward a local-first view of agent execution graphs and loops. The product remains read-only: it observes runs but does not control agent processes.

### Now

- Build a provider-neutral execution graph from retained Codex, OpenCode, and Claude Code events.
- Expose graph nodes, transition counts, and detected cycles through `consensus graph`.
- Keep graph output versioned and explicit about its observed event window.

### Next

- Add parent, subagent, delegation, approval, retry, and handoff edges when providers expose them.
- Stream graph deltas through the server and render graph structure in the isometric UI.
- Add loop health signals: duration, retry count, stop-rule status, budget use, and stuck-loop warnings.
- Compare declared workflow graphs with the task graph created at runtime.

### Later

- Compact mini-map and graph grouping controls.
- Multi-device aggregation through an optional cloud relay with one graph and timeline.
- Run comparison, graph replay, and export for audit and evaluation.
- Basic performance profiling and render budget notes.

## Existing reliability work

- Improve session-to-process matching with PID metadata when available.
- Keep provider activity parsing stable across Codex, OpenCode, and Claude Code.
