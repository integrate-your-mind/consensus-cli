# Configuration

All configuration uses environment variables.

## Server

- `CONSENSUS_HOST`
  - Default: `127.0.0.1`
  - HTTP bind address.
- `CONSENSUS_PORT`
  - Default: `8787`
  - HTTP and WebSocket port.
- `CONSENSUS_UI_PORT`
  - Default: `5173`
  - Vite development port.
- `CONSENSUS_POLL_MS`
  - Process-presence scan interval.
- `CONSENSUS_SCAN_TIMEOUT_MS`
  - Default: `5000`
  - Maximum scan duration.
- `CONSENSUS_SCAN_STALL_MS`
  - Default: 60% of the scan timeout, minimum `250`.
- `CONSENSUS_SCAN_STALL_CHECK_MS`
  - Stall-check interval.

## Codex

- `CONSENSUS_CODEX_HOME`
  - Default: `~/.codex`.
- `CONSENSUS_CODEX_NOTIFY_INSTALL`
  - Deprecated compatibility path. Use `npx consensus-cli setup`.
  - Values `0`, `false`, or `off` disable it.
- `CONSENSUS_CODEX_NOTIFY_INSTALL_TIMEOUT_MS`
  - Default: `5000`.
- `CONSENSUS_CODEX_WATCH_POLL`
  - Set to `0` to disable polling-based JSONL watching.
- `CONSENSUS_CODEX_WATCH_INTERVAL_MS`
  - Default: `1000`.
- `CONSENSUS_CODEX_WATCH_BINARY_INTERVAL_MS`
  - Defaults to the watch interval.
- `CONSENSUS_CODEX_EVENT_ACTIVE_MS`
  - Recent-event activity window.
- `CONSENSUS_CODEX_ACTIVE_HOLD_MS`
  - Default: `3000`.
- `CONSENSUS_CODEX_INFLIGHT_IDLE_MS`
  - Default: `30000`; set `0` to disable.
- `CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS`
  - Default: `3000`.
- `CONSENSUS_CODEX_FILE_FRESH_MS`
  - JSONL freshness window.
- `CONSENSUS_CODEX_STALE_FILE_MS`
  - Default: `120000`.
- `CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS`
  - Defaults to the in-flight timeout.

Current Codex documentation defines `notify` as an array of command arguments in the user-level `~/.codex/config.toml`. Project-local config does not support `notify`.

## OpenCode

- `CONSENSUS_OPENCODE_HOST`
  - Default: `127.0.0.1`.
- `CONSENSUS_OPENCODE_PORT`
  - Default: `4096`.
- `CONSENSUS_OPENCODE_TIMEOUT_MS`
  - Default: `5000`.
- `CONSENSUS_OPENCODE_AUTOSTART`
  - Default: enabled for the live dashboard.
  - Set to `0` to disable.
  - `consensus graph` disables autostart internally regardless of this setting.
- `CONSENSUS_OPENCODE_EVENTS`
  - Set to `0` to disable SSE activity ingestion.
- `CONSENSUS_OPENCODE_HOME`
  - Default: `~/.local/share/opencode`.
- `CONSENSUS_OPENCODE_EVENT_ACTIVE_MS`
  - Recent-event activity window.
- `CONSENSUS_OPENCODE_ACTIVE_HOLD_MS`
  - Default: `3000`.
- `CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS`
  - In-flight idle decay window.
- `CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS`
  - Default: `15000`.
- `CONSENSUS_DEBUG_OPENCODE`
  - Set to `1` for discovery logs.

## Claude Code

- `CONSENSUS_CLAUDE_EVENT_TTL_MS`
  - Default: `1800000` (30 minutes).
  - In-memory and hydrated metadata age limit.
- `CONSENSUS_CLAUDE_INFLIGHT_TIMEOUT_MS`
  - Default: `15000`.
- `CONSENSUS_CLAUDE_ACTIVE_HOLD_MS`
  - Default: `3000`.
- `CONSENSUS_CLAUDE_EVENT_LOG`
  - Default: `~/.consensus/claude-events.jsonl`.
  - Set a custom local path, or `0`, `false`, or `off` to disable cross-process graph history.
- `CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES`
  - Default: `1048576` (1 MiB).
  - Minimum accepted value: 64 KiB.
  - When the file exceeds the bound, Consensus keeps roughly the newest half.

The Claude log contains metadata only. It excludes prompts, assistant text, message deltas, tool input/output, transcript paths, task descriptions, and error details.

## Privacy and matching

- `CONSENSUS_REDACT_PII`
  - Default: enabled.
  - Set to `0` to disable normal text redaction.
  - Graph identity fields remain opaque even when text redaction is disabled.
- `CONSENSUS_PROCESS_MATCH`
  - Optional regular expression for Codex process matching.
- `CONSENSUS_INCLUDE_CODEX_VENDOR`
  - Set to `1` or `true` to include standalone vendor processes.

## Cache and activity

- `CONSENSUS_PROCESS_CACHE_MS`
  - Default: `1000`.
- `CONSENSUS_PROCESS_CACHE_FAST_MS`
  - Default: `500`.
- `CONSENSUS_SESSION_CACHE_MS`
  - Default: `1000`.
- `CONSENSUS_SESSION_CACHE_FAST_MS`
  - Default: `500`.
- `CONSENSUS_EVENT_ACTIVE_MS`
  - General recent-event window.
- `CONSENSUS_ACTIVE_HOLD_MS`
  - Default: `3000`.
- `CONSENSUS_IDLE_HOLD_MS`
  - Default: `200`.
- `CONSENSUS_SPAN_STALE_MS`
  - Default: `15000`.

## Observability

- `CONSENSUS_OTEL_ENABLED`
- `CONSENSUS_OTEL_ENDPOINT`
- `CONSENSUS_OTEL_SERVICE_NAME`
- `CONSENSUS_OTEL_ENV`
- `CONSENSUS_OTEL_VERSION`
- `CONSENSUS_OTEL_SAMPLE_RATIO`
- `CONSENSUS_OTEL_METRIC_INTERVAL_MS`
- `CONSENSUS_OTEL_CONSOLE_FALLBACK`
- `CONSENSUS_PROFILE`
- `CONSENSUS_PROFILE_MS`
- `CONSENSUS_DEBUG_ACTIVITY`

## Test mode

- `ACTIVITY_TEST_MODE=1`
  - Enables test-only activity routes.
