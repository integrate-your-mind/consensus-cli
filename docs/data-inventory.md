# Data inventory

## Data observed

- Process metadata: PID, command line, CPU, memory, and working directory.
- Recent Codex event summaries and local session metadata.
- OpenCode session, status, message-summary, and SSE event metadata.
- Claude hook metadata: event type, session ID, timestamp, working directory, transcript path, notification type, tool name, agent type, final-message marker, and current activity state.

Raw prompt, assistant, tool-input, and tool-output content can exist in provider-owned logs or hook payloads. Consensus normalizes only bounded summaries for its live snapshot.

## Graph export

Graph JSON contains:

- opaque agent keys
- provider and repository labels
- turn-segment numbers
- normalized phases and event types
- transition observation counts
- loop membership and current state

Graph relationship IDs do not contain raw Codex session paths or raw working directories.

## Claude metadata storage

To make one-shot `scan` and `graph` commands see hook history captured by the running server, Consensus writes a bounded local metadata file at:

```text
~/.consensus/claude-events.jsonl
```

Stored fields:

- schema version
- event type
- session ID
- timestamp
- opaque SHA-256 working-directory key
- notification type
- tool name
- agent type
- final-message marker

Not stored:

- raw working directory
- transcript path
- prompt text
- assistant text or `MessageDisplay.delta`
- message or turn IDs
- tool input or output
- task subject or description
- error details

The file is mode `0600`, the directory is created with mode `0700`, and the default bound is 1 MiB.

## Retention and deletion

- Provider event arrays are bounded in memory.
- Claude metadata older than `CONSENSUS_CLAUDE_EVENT_TTL_MS` is ignored during hydration.
- Set `CONSENSUS_CLAUDE_EVENT_LOG=0` to disable new writes.
- Stop Consensus and delete `~/.consensus/claude-events.jsonl` to clear persisted Claude metadata.
- Stop the server to clear in-memory state.
