# Configuration

All configuration is via environment variables.

## Variables
- `CONSENSUS_HOST`
  - Default: `127.0.0.1`
  - Bind address for the server.
- `CONSENSUS_PORT`
  - Default: `8787`
  - Port for the HTTP server.
- `CONSENSUS_POLL_MS`
  - Default: `1000`
  - Poll interval for scans.
- `CONSENSUS_CODEX_HOME`
  - Default: `~/.codex`
  - Override Codex home directory.
- `CONSENSUS_OPENCODE_HOST`
  - Default: `127.0.0.1`
  - OpenCode server host.
- `CONSENSUS_OPENCODE_PORT`
  - Default: `4096`
  - OpenCode server port.
- `CONSENSUS_OPENCODE_AUTOSTART`
  - Default: enabled
  - Set to `0` to disable OpenCode server autostart.
- `CONSENSUS_OPENCODE_EVENTS`
  - Default: enabled
  - Set to `0` to disable OpenCode event stream.
- `CONSENSUS_PROCESS_MATCH`
  - Default: unset
  - Regex to match process name or command line.
- `CONSENSUS_REDACT_PII`
  - Default: enabled
  - Set to `0` to disable redaction.
- `CONSENSUS_EVENT_ACTIVE_MS`
  - Default: `300000`
  - Window after the last event to mark an agent active.
- `CONSENSUS_CPU_ACTIVE`
  - Default: `1`
  - CPU threshold for marking an agent active.
- `CONSENSUS_ACTIVE_HOLD_MS`
  - Default: `600000`
  - Keep agents active for this long after activity.

## Example
```bash
CONSENSUS_PORT=8790 CONSENSUS_POLL_MS=750 npm run dev
```
