# Data inventory

## Data collected
- Process metadata: pid, cmdline, cpu, memory, cwd.
- Recent Codex session event summaries (best-effort).
- Claude hook events (session id, cwd, transcript path, event type).

## Storage
- No persistent storage outside the local machine.
- Data is held in memory for live rendering only.

## Retention
- No historical retention; data refreshes per poll.

## Deletion
- Stop the server to clear in-memory data.
