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
4) Read Claude Code CLI flags to infer current work.
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
- `CONSENSUS_POLL_MS`: polling interval in ms (default `1000`).
- `CONSENSUS_CODEX_HOME`: override Codex home (default `~/.codex`).
- `CONSENSUS_OPENCODE_HOST`: OpenCode server host (default `127.0.0.1`).
- `CONSENSUS_OPENCODE_PORT`: OpenCode server port (default `4096`).
- `CONSENSUS_OPENCODE_AUTOSTART`: set to `0` to disable OpenCode autostart.
- `CONSENSUS_OPENCODE_EVENTS`: set to `0` to disable OpenCode event stream.
- `CONSENSUS_PROCESS_MATCH`: regex to match codex processes.
- `CONSENSUS_REDACT_PII`: set to `0` to disable redaction (default enabled).
- `CONSENSUS_EVENT_ACTIVE_MS`: active window after last event in ms (default `300000`).
- `CONSENSUS_CPU_ACTIVE`: CPU threshold for active state (default `1`).
- `CONSENSUS_ACTIVE_HOLD_MS`: keep active state this long after activity (default `600000`).

Full config details: `docs/configuration.md`

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
