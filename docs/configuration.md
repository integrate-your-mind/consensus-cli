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
- `CONSENSUS_PROCESS_MATCH`
  - Default: unset
  - Regex to match process name or command line.
- `CONSENSUS_REDACT_PII`
  - Default: enabled
  - Set to `0` to disable redaction.

## Example
```bash
CONSENSUS_PORT=8790 CONSENSUS_POLL_MS=750 npm run dev
```
