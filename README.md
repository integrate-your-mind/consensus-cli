# consensus-cli

[![npm](https://img.shields.io/npm/v/consensus-cli.svg?color=0f766e)](https://www.npmjs.com/package/consensus-cli)
[![GitHub release](https://img.shields.io/github/v/release/integrate-your-mind/consensus-cli?display_name=tag&color=2563eb)](https://github.com/integrate-your-mind/consensus-cli/releases)
[![License](https://img.shields.io/npm/l/consensus-cli.svg?color=6b7280)](LICENSE)

Live isometric atlas for Codex, OpenCode, and Claude Code sessions, rendered in a local browser.

## Status
Beta. Local-only, no hosted service.

## Who it's for
Developers running multiple Codex, OpenCode, or Claude Code sessions who want a visual, at-a-glance view of activity.

## Core use cases
- Track which agents are active right now.
- Spot errors or idle processes quickly.
- Inspect recent activity without digging through logs.

## Scope (non-goals)
- Does not start, stop, or manage processes.
- Does not connect to remote Codex, OpenCode, or Claude Code instances.
- No authentication or multi-user access.

## Quickstart
```bash
npm install
npm run dev
```

The server prints the local URL (default `http://127.0.0.1:8787`).
Consensus reads local Codex CLI sessions and does not require API keys.
You just need Codex CLI installed and signed in (Pro subscription or team plan).
If OpenCode is installed, Consensus will auto-start its local server.
If Claude Code is installed, it will appear automatically (run `claude` once to sign in).
Claude activity tracking requires hooks (see "Claude hooks" below).
`npm run dev` also keeps `dist/claudeHook.js` up to date so hooks can point at the compiled entry during development.

## Run via npx
```bash
npx consensus-cli
```

Expected output:
```
consensus dev server running on http://127.0.0.1:8787
```

## What you get
- One tile per running `codex`, `opencode`, or `claude` process.
- Activity state (active/idle/error) from CPU and recent events.
- Best-effort "doing" summary from Codex session JSONL, OpenCode events, or Claude CLI flags.
- Click a tile for details and recent events.
- Active lane for agents plus a dedicated lane for servers.

## How it works
1) Scan OS process list for Codex + OpenCode + Claude Code.
2) Resolve Codex session JSONL under `CODEX_HOME/sessions/`.
3) Query the OpenCode local server API and event stream (with storage fallback).
4) Ingest Claude Code hook events to infer activity (CLI flags only for "doing").
5) Poll and push snapshots over WebSocket.
6) Render tiles on a canvas with isometric projection.

## Install options
- Local dev: `npm install` + `npm run dev`
- npx: `npx consensus-cli`
- Docker: not available yet
- Hosted: planned (opt-in aggregation later)

## Configuration
- `CONSENSUS_HOST`: bind address (default `127.0.0.1`).
- `CONSENSUS_PORT`: server port (default `8787`).
- `CONSENSUS_POLL_MS`: process presence polling interval in ms (default `500`).
- `CONSENSUS_SCAN_TIMEOUT_MS`: scan timeout in ms (default `5000`).
- `CONSENSUS_SCAN_STALL_MS`: scan stall warning threshold in ms (default `60%` of timeout, min `250`).
- `CONSENSUS_SCAN_STALL_CHECK_MS`: scan stall check interval in ms (default `min(1000, stallMs)`, min `250`).
- `CONSENSUS_CODEX_HOME`: override Codex home (default `~/.codex`).
- `CONSENSUS_CODEX_NOTIFY_INSTALL`: optional path to install a Codex `notify` hook via `codex config set -g notify=["<path>"]` (set to `0`/`false` to disable auto-install).
- `CONSENSUS_OPENCODE_HOST`: OpenCode server host (default `127.0.0.1`).
- `CONSENSUS_OPENCODE_PORT`: OpenCode server port (default `4096`).
- `CONSENSUS_OPENCODE_TIMEOUT_MS`: OpenCode request timeout in ms (default `5000`).
- `CONSENSUS_OPENCODE_AUTOSTART`: set to `0` to disable OpenCode autostart.
- `CONSENSUS_OPENCODE_EVENTS`: set to `0` to disable OpenCode event stream.
- `CONSENSUS_OPENCODE_HOME`: override OpenCode storage (default `~/.local/share/opencode`).
- `CONSENSUS_OPENCODE_EVENT_ACTIVE_MS`: OpenCode active window after last event in ms (default `0`).
- `CONSENSUS_OPENCODE_ACTIVE_HOLD_MS`: OpenCode hold window in ms (default `3000`).
- `CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS`: OpenCode in-flight idle timeout in ms (defaults to `CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS`).
- `CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS`: OpenCode hard in-flight timeout in ms (default `15000`).
- `CONSENSUS_PROCESS_MATCH`: regex to match codex processes.
- `CONSENSUS_REDACT_PII`: set to `0` to disable redaction (default enabled).
- `CONSENSUS_UI_PORT`: dev UI port for Vite when running `npm run dev` (default `5173`).
- `CONSENSUS_DEBUG_OPENCODE`: set to `1` to log OpenCode server discovery.
- `CONSENSUS_CODEX_EVENT_ACTIVE_MS`: Codex active window after last event in ms (default `30000`).
- `CONSENSUS_CODEX_ACTIVE_HOLD_MS`: Codex hold window in ms (default `3000`).
- `CONSENSUS_CODEX_INFLIGHT_IDLE_MS`: Codex in-flight idle timeout in ms (default `30000`, set to `0` to disable).
- `CONSENSUS_CODEX_CPU_SUSTAIN_MS`: sustained CPU window before Codex becomes active without logs (default `500`).
- `CONSENSUS_CODEX_CPU_SPIKE`: Codex CPU spike threshold for immediate activation (default derived).
- `CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS`: Codex in-flight timeout in ms (default `3000`).
- `CONSENSUS_CODEX_SIGNAL_MAX_AGE_MS`: Codex max event age for in-flight signals (default `CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS`).
- `CONSENSUS_PROCESS_CACHE_MS`: process cache TTL in ms for full scans (default `1000`).
- `CONSENSUS_PROCESS_CACHE_FAST_MS`: process cache TTL in ms for fast scans (default `500`).
- `CONSENSUS_SESSION_CACHE_MS`: Codex session list cache TTL in ms for full scans (default `1000`).
- `CONSENSUS_SESSION_CACHE_FAST_MS`: Codex session list cache TTL in ms for fast scans (default `500`).
- `CONSENSUS_EVENT_ACTIVE_MS`: active window after last event in ms (default `300000`).
- `CONSENSUS_CPU_ACTIVE`: CPU threshold for active state (default `1`).
- `CONSENSUS_CLAUDE_CPU_ACTIVE`: Claude CPU threshold override (default `1`).
- `CONSENSUS_CLAUDE_CPU_SUSTAIN_MS`: Claude sustained CPU window in ms (default `1000`).
- `CONSENSUS_CLAUDE_CPU_SPIKE`: Claude spike threshold override (default derived).
- Claude activity uses hooks; CPU settings are legacy and ignored for TUI activity.
- `CONSENSUS_CLAUDE_EVENT_TTL_MS`: Claude hook event TTL in ms (default `1800000`).
- `CONSENSUS_CLAUDE_INFLIGHT_TIMEOUT_MS`: Claude in-flight timeout if no hook events (default `15000`).
- `CONSENSUS_CLAUDE_ACTIVE_HOLD_MS`: Claude hold window in ms (default `3000`).
- `CONSENSUS_ACTIVE_HOLD_MS`: keep active state this long after activity (default `3000`).
- `CONSENSUS_IDLE_HOLD_MS`: hold idle state briefly after spans end (default `200`).
- `CONSENSUS_SPAN_STALE_MS`: span stale timeout for event progress (default `15000`).

Full config details: `docs/configuration.md`

## Claude hooks (required for activity)
Claude Code hooks are configured in `~/.claude/settings.json`, `.claude/settings.json`, or
`.claude/settings.local.json`.
Consensus ignores Claude `statusLine`; hooks are the sole Claude activity signal.
Hook handler source lives in `src/claudeHook.ts` (Effect) and is compiled to `dist/claudeHook.js`.

Example (repeat the command for the events you want to track):
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event"
          }
        ]
      }
    ]
  }
}
```

Notes:
- Tool-related hooks (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`) require a `matcher`. Use `"*"` to capture all tools.
- Claude hooks send JSON via stdin; `dist/claudeHook.js` expects `hook_event_name` and `session_id`.
- Dev (dynamic TS): use `node --import tsx /path/to/consensus-cli/src/claudeHook.ts http://127.0.0.1:8787/api/claude-event` so hook changes apply without rebuilds.

Recommended events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionEnd`,
`Notification`.

## Utilities
- `npm run scan` prints a one-shot JSON snapshot.
- `npm run tail -- <session.jsonl>` tails a session file.

## Tests
```bash
npm run test
```

## Troubleshooting
- Port conflict on 8787: set `CONSENSUS_PORT=8790`.
- If the browser cannot connect, try `http://[::1]:<port>` or set `CONSENSUS_HOST=127.0.0.1`.
- If "doing" is empty, the session log may not be resolvable yet.

More: `docs/troubleshooting.md`

## Documentation
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/install.md`
- `docs/examples.md`
- `docs/cli.md`
- `docs/decisions/`
- `docs/audience.md`
- `docs/promises.md`
- `docs/problem.md`
- `docs/data-inventory.md`
- `docs/threat-model.md`
- `docs/constitution.md`
- `docs/testing.md`
- `docs/release.md`
- `docs/troubleshooting.md`

## Contributing
See `CONTRIBUTING.md`.

## Security
See `SECURITY.md`.

## Governance
See `GOVERNANCE.md`.

## Roadmap
See `ROADMAP.md`.

## Support
See `SUPPORT.md`.

## License and trademark
Apache-2.0 License. See `LICENSE`.

"consensus" is a project name used by the maintainer. Please do not imply
endorsement or use logos without permission.

## Open source note
Development happens in the open via issues and pull requests.

## Why open source
This project is meant to be forked, remixed, and adapted to your local workflows.

## Hosted vision
The OSS version stays local-first. A future hosted service could optionally
aggregate agents across machines with a unified web dashboard.
