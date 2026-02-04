# API authentication patterns

This document records how Consensus exposes HTTP/WS APIs today and how callers prove they belong inside the local trust boundary.

## Trust boundary
- The server binds to `CONSENSUS_HOST` (default `127.0.0.1`) and `CONSENSUS_PORT` (default `8787`). By default all API traffic stays on localhost and the UI/API share the same origin.
- Remote bind is blocked unless `CONSENSUS_ALLOW_REMOTE=1` and `CONSENSUS_API_TOKEN` are both set. This prevents accidental exposure of unauthenticated endpoints.
- When `CONSENSUS_API_TOKEN` is set, all API and WebSocket clients must present `Authorization: Bearer <token>` (or `?token=<token>` for WebSocket/browser clients).

## Endpoint summary
| Route | Method | Purpose | Authentication | Notes |
|-------|--------|---------|----------------|-------|
| `/api/snapshot` | `GET` | Returns the last snapshot emitted by the scan loop. | Required when token is set or host is non-loopback. | The handler runs `scanCodexProcesses` and pushes a JSON payload (ts + agents). |
| `/health` | `GET` | Basic JSON health check for monitoring. | None | Always responds `{ ok: true }`. |
| `/api/codex-event` | `POST` | Codex notify hook forwards Codex events into the server. | Required when token is set or host is non-loopback. | Payload validated against `CodexEventSchema`; rejects with `400` on schema mismatch. | 
| `/api/claude-event` | `POST` | Claude Code hooks post lifecycle events. | Required when token is set or host is non-loopback. | Schema validated via `ClaudeEventSchema`; `dist/claudeHook.js` reads stdin and forwards to this endpoint. |
| `/__debug/activity` | `POST` | Toggles extra activity logging. | Required when token is set or host is non-loopback. | Accepts `enable` via query or JSON body. |
| `/__dev/reload` | `GET (SSE)` | Development reload stream for browser clients. | Required when token is set or host is non-loopback. | Only available when `CONSENSUS_LIVE_RELOAD=1`. |

The UI also opens a WebSocket (handled by `ws` in `src/server.ts`). When `CONSENSUS_API_TOKEN` is set, the WebSocket must include `?token=<token>` in the URL.

## Client expectations
- Codex notify hooks call `noun codex config set -g notify` with the Consensus endpoint (`/api/codex-event`). If `CONSENSUS_API_TOKEN` is set, the hook forwards `Authorization: Bearer <token>`.
- Claude Code hooks run `dist/claudeHook.js` which POSTs a minimal JSON event directly to `/api/claude-event`. If `CONSENSUS_API_TOKEN` is set, the hook forwards `Authorization: Bearer <token>`.
- The browser UI opens the WebSocket, optionally with `?token=<token>` if required.

## Hardening guidance
1. Keep the remote bind guard (`CONSENSUS_ALLOW_REMOTE=1` + `CONSENSUS_API_TOKEN`) in place to prevent accidental exposure.
2. Pair remote exposure with a TLS-terminating reverse proxy and firewall rules.
3. Continue schema validation for Codex/Claude events so malformed payloads are rejected before processing.
4. Treat `CONSENSUS_API_TOKEN` as a secret; rotate if leaked.

## Observability
- Authentication and access attempts are logged via `recordHttpMetrics` and `annotateSpan` without exposing tokens.
