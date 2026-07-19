# API authentication patterns

This document records how Consensus exposes HTTP/WS APIs today and how callers prove they belong inside the local trust boundary.

## Trust boundary
- The server binds to `CONSENSUS_HOST` (default `127.0.0.1`) and `CONSENSUS_PORT` (default `8787`). By default all API traffic stays on localhost and the UI/API share the same origin.
- There is no built-in token, cookie, or OAuth layer. The assumption is that if a client can reach the port, it is running on the same machine (or behind an OS-level firewall or SSH tunnel) and therefore already trusted.
- `docs/constitution.md` mandates that any future remote access requires authentication, so the current pattern is safe only because the default bind address never leaves the host.

## Endpoint summary
| Route | Method | Purpose | Authentication | Notes |
|-------|--------|---------|----------------|-------|
| `/api/snapshot` | `GET` | Returns the last snapshot emitted by the scan loop (cached). | None | Use `?mode=full` for a synchronous full scan (bounded by `CONSENSUS_SCAN_TIMEOUT_MS`). Use `?refresh=1` to request a scan tick without blocking the response. |
| `/health` | `GET` | Basic JSON health check for monitoring. | None | Always responds `{ ok: true }`. |
| `/api/codex-event` | `POST` | Codex notify hook triggers a fast scan. | None | Payload validated against `CodexEventSchema`; rejects with `400` on schema mismatch. Events are not merged into activity state. | 
| `/api/claude-event` | `POST` | Claude Code hooks post lifecycle events. | None | Schema validated via `ClaudeEventSchema`; `dist/claudeHook.js` reads stdin and forwards to this endpoint. |
| `/__debug/activity` | `POST` | Toggles extra activity logging (guarded by localhost). | None | Accepts `enable` via query or JSON body. |
| `/__dev/reload` | `GET (SSE)` | Development reload stream for browser clients. | None | Only available when `CONSENSUS_LIVE_RELOAD=1`. |

The UI also opens a WebSocket (handled by `ws` in `src/server.ts`) but the WebSocket connection is only permitted from the same origin as the served static files.

## Client expectations
- Codex notify hooks call `codex config set -g notify` with the Consensus endpoint (`/api/codex-event`) and expect no authentication steps beyond the default localhost requirement. Codex in-flight state is derived from session JSONL logs (e.g. `~/.codex/sessions/.../*.jsonl`); the webhook only triggers faster scans.
- Claude Code hooks run `dist/claudeHook.js` which POSTs a minimal JSON event directly to `/api/claude-event` from the hook process; it neither signs the request nor retries if the hook fails.
- The browser UI connects over WebSocket for snapshots and deltas. `/api/snapshot` is primarily for polling tools and debugging.

## Hardening guidance
1. Any time the server binds to a non-localhost address (custom `CONSENSUS_HOST`), add auth before enabling the port in `docs/constitution.md`'s sense. A simple opt-in token header (configured via an environment variable) or Mutual TLS would be appropriate.
2. When introducing authentication, keep the current schema validation for Codex/Claude events so that invalid or replayed payloads are rejected even before checking credentials.
3. For debugging or automation endpoints (`/__debug/activity`, `/__dev/reload`), gate them behind the same token or a separate debug-only header to keep the trust boundary intact.
4. Document the chosen auth pattern once implemented (update this file). If more than localhost access is required, pair it with firewall rules or SSH tunnels that still keep secrets off disk.

## Observability
- Authentication and access attempts should be logged without secrets, matching the `IX.7` rule in `docs/constitution.md`. Currently, there are no tokens to log, so the focus is on request/response status.
- Future token-based auth can reuse `recordHttpMetrics` and `annotateSpan` already wired in `runHttpEffect` to trace auth failures alongside scan duration and errors.
