# Graphs and loops

Consensus treats an observed agent loop as a cycle inside a turn-scoped execution graph.

- **Graph:** which agents and normalized work phases were observed, and which transitions occurred?
- **Loop:** which transitions within one observed turn return to an earlier phase?

Consensus remains read-only. It reports local activity and does not start, stop, retry, route, approve, or otherwise control agent work.

## Commands

```bash
npx consensus-cli graph
npx consensus-cli graph --json
npx consensus-cli graph --snapshot snapshot.json
cat snapshot.json | npx consensus-cli graph --snapshot -
```

Live graph inspection disables OpenCode autostart before loading the scanner. Saved snapshots receive strict structural validation before graph construction.

## Version 1 data model

### Agent nodes

Each observed process or session produces one `agent` node. Graph output derives an opaque `agentKey` from provider plus local identity. It never includes the original Codex session path in graph IDs or relationship fields.

### Turn segments

Step nodes are scoped to an observed turn segment:

```text
step:<opaque-agent-key>:s<segment>:<phase>
```

A new prompt opens a new segment. Explicit end events such as `turn.completed`, `Stop`, `StopFailure`, and `SessionEnd` close the current segment. No transition edge crosses a segment boundary.

This rule prevents a routine second prompt from closing a cycle through the prior turn.

### Phases

Provider events normalize to:

- `prompt`
- `model`
- `tool`
- `command`
- `edit`

Unknown non-lifecycle events remain visible under their normalized event name. Lifecycle and transport records are excluded, including session/thread/turn/response status events, token counts, heartbeats, connection events, compaction, notifications, and standalone configuration or filesystem notifications.

### Edges

- `contains`: agent to turn-scoped step.
- `transition`: one phase to the next phase in the same segment.

Adjacent events in the same phase collapse into one visit. Repeated non-adjacent transitions increase the edge observation count.

### Loops

Consensus runs strongly connected component detection over transition edges.

- A self-edge is a `self` loop.
- Two or more mutually reachable step nodes form a `cycle` loop.

`transitionObservations` is the sum of internal edge observations. It is not a completed-iteration count and must not be used as a retry budget without a separate traversal model.

### Current state

Only the latest observed step for an agent is marked `current` and receives the agent's live `active`, `idle`, or `error` state. Older step nodes remain idle, even if their phase names match the current phase in a later turn. A historical loop therefore cannot become active merely because the agent is active elsewhere.

`hadError` records whether an error event occurred on a step without converting that historical step into a current error state.

## Provider coverage

Provider contracts were checked on July 18, 2026.

### Codex

Consensus uses the user-level Codex notify command plus bounded local JSONL summaries. Current Codex configuration documents `notify` as an array of command arguments in `~/.codex/config.toml`; project-local config does not support it.

Source: <https://developers.openai.com/codex/config-reference>

### OpenCode

Consensus reads the local HTTP server, `/global/event` and `/event` SSE streams, session status, and retained message activity. Version 1 does not infer parent or delegation edges. The current server contract exposes `parentID` on session creation and `/session/:id/children`, which can support explicit parent/subagent edges later.

Source: <https://opencode.ai/docs/server/>

### Claude Code

Consensus receives hook events through `src/claudeHook.ts`. Current Claude Code hooks include `MessageDisplay`, `PostToolBatch`, `PermissionDenied`, `TaskCreated`, `TaskCompleted`, and `StopFailure` in addition to the original session, prompt, tool, subagent, and stop events.

`MessageDisplay` can fire several times while one assistant message streams. Consensus uses partial batches only as activity pulses and retains the final marker. It never stores `delta` content.

`UserPromptSubmit` defines the graph turn boundary. `UserPromptExpansion` is treated as activity only and is not retained as a second prompt phase, avoiding a duplicate segment for direct slash-command expansion.

The metadata log retains only:

- event type
- session ID
- timestamp
- opaque working-directory key
- notification type
- tool name
- agent type
- final-message marker

It excludes prompt text, assistant text, message and turn IDs, tool input and output, transcript path, task subject and description, and error details.

Source: <https://code.claude.com/docs/en/hooks>

### OpenClaw framing

OpenClaw's documented agent loop remains a serialized runtime loop around model inference, tools, streaming, and persistence. Consensus models that loop as turn-scoped cycles inside a broader observed graph.

Source: <https://docs.openclaw.ai/concepts/agent-loop>

## Retention and privacy

- Snapshot events remain bounded by each provider adapter.
- Claude cross-process metadata defaults to `~/.consensus/claude-events.jsonl`.
- The file mode is set to `0600`; its directory is created with mode `0700`.
- Default maximum size is 1 MiB. When exceeded, the log keeps roughly the newest half.
- Set `CONSENSUS_CLAUDE_EVENT_LOG=0` to disable it.
- Stop the server and remove the metadata file to clear retained Claude graph history.

## Current limits

- The graph reflects retained evidence, not a full workflow definition.
- Turn boundaries are best effort when a provider omits explicit lifecycle events; every prompt still starts a new segment.
- Version 1 does not represent parent, delegation, approval, retry, handoff, or cross-agent causal edges.
- Loop duration, iteration count, stop-rule status, and budget use need additional event models.

## Next slices

1. Add explicit parent and child edges from provider-supported identifiers.
2. Stream graph deltas through the server and render them in the browser.
3. Compare declared workflow graphs with runtime-created task graphs.
4. Add traversal-aware loop counts, budgets, stop rules, and stuck-loop alerts.
