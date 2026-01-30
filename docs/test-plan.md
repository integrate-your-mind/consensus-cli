# Test Plan (TDD)

This plan enumerates the edge cases we will test before changing behavior.
Each case uses Given/When/Then (GWT).

## Activity + Animation
- Codex idle on user prompt
  - Given a Codex session that only emits user prompt messages
  - When snapshots are computed
  - Then the agent state is idle and no active animation is shown
- Codex active on assistant output
  - Given a Codex session with assistant response output
  - When snapshots are computed
  - Then the agent state is active and animation is shown
- Codex active on tool/command/edit
  - Given a Codex session with tool/command/edit events
  - When snapshots are computed
  - Then the agent state is active and animation is shown
- OpenCode active on in-flight
  - Given OpenCode events marked started/running
  - When snapshots are computed
  - Then the agent state is active until completed/idle
- Claude idle without hook events
  - Given Claude TUI (terminal user interface) with no hook events
  - When snapshots are computed
  - Then the agent remains idle

## In-flight Transitions
- Codex response started/completed
  - Given response.started then response.completed events
  - When tail is updated across both events
  - Then in-flight toggles true then false
- OpenCode started/completed
  - Given OpenCode events with started/completed statuses
  - When ingested
  - Then in-flight toggles true then false

## Duplicates + Identity
- One tile per PID
  - Given two agents with same repo/cwd but distinct PID
  - When rendering lanes
  - Then both appear as separate list entries
- Helper process exclusion
  - Given Codex helper/vendor processes
  - When scanning
  - Then they are excluded from snapshots

## Real-time + Lag
- Poll interval bounds
  - Given CONSENSUS_POLL_MS (millisecond) set
  - When snapshots are streamed
  - Then UI updates within the poll window
- WebSocket (WS) override
  - Given a WS override endpoint
  - When the server streams a snapshot
  - Then the UI reflects the override source

## Error + Recovery
- Error overrides active
  - Given an event marked error
  - When snapshots are computed
  - Then the agent state is error regardless of CPU
- Malformed JSONL (JSON Lines) in Codex logs
  - Given a bad line between two good lines
  - When parsing
  - Then parsing continues and activity still reflects the good lines
