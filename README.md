# consensus-cli

[![npm](https://img.shields.io/npm/v/consensus-cli.svg?color=0f766e)](https://www.npmjs.com/package/consensus-cli)
[![GitHub release](https://img.shields.io/github/v/release/integrate-your-mind/consensus-cli?display_name=tag&color=2563eb)](https://github.com/integrate-your-mind/consensus-cli/releases)
[![License](https://img.shields.io/npm/l/consensus-cli.svg?color=6b7280)](LICENSE)

Local-first observability for coding-agent graphs, loops, and live activity across Codex, OpenCode, and Claude Code.

## Status

Beta. Local-only, with no hosted service.

## Core use cases

- Inspect observed prompt, model, tool, command, and edit transitions.
- Detect cycles inside individual observed turns.
- Track active, idle, and error states across local coding agents.
- Inspect recent activity without reading raw provider logs.

## Scope

Consensus observes local runs. It does not start, stop, retry, route, approve, or otherwise control agent work. The default server can auto-start OpenCode for the live dashboard; the one-shot `consensus graph` command explicitly disables that side effect.

## Quickstart

```bash
npm install
npm run dev
```

The server prints a local URL, normally `http://127.0.0.1:8787`.

Run the published CLI:

```bash
npx consensus-cli
```

Consensus reads local Codex sessions and does not require an API key. OpenCode and Claude Code support depend on their local server and hook interfaces.

## Graphs and loops

Inspect current local sessions:

```bash
npx consensus-cli graph
```

Print the versioned JSON graph:

```bash
npx consensus-cli graph --json
```

Analyze a saved snapshot:

```bash
npm run scan > snapshot.json
npx consensus-cli graph --snapshot snapshot.json
```

Read a snapshot from standard input:

```bash
cat snapshot.json | npx consensus-cli graph --snapshot -
```

The graph model:

- Creates one opaque agent key per observed process or session.
- Splits step nodes by observed turn so separate prompts cannot create a false cycle.
- Filters lifecycle and transport events such as `turn.completed`, `session.status`, heartbeat, and token-count records.
- Collapses adjacent fragments of the same phase.
- Detects strongly connected components only within a turn segment.
- Applies live state only to the latest observed step. Historical loops remain idle.
- Reports `transitionObservations`, which counts internal transition evidence rather than claiming completed loop iterations.

Raw session paths are not included in graph IDs. See [`docs/graphs-and-loops.md`](docs/graphs-and-loops.md) for the full contract.

## Provider data flow

1. Scan local Codex, OpenCode, and Claude Code processes.
2. Read bounded Codex JSONL summaries and notify events.
3. Read OpenCode sessions and SSE events from the local server.
4. Receive Claude Code hooks and retain bounded metadata-only event history.
5. Build live snapshots and stream them to the browser.
6. Derive per-turn execution graphs and detected cycles.

### Codex

`consensus setup` writes the notify command to the user-level `~/.codex/config.toml`. Current Codex documentation defines `notify` as a command array and notes that project-local config does not support it.

```bash
npx consensus-cli setup
```

### OpenCode

Consensus reads the local OpenCode HTTP server and its SSE event streams. The dashboard may auto-start `opencode serve` unless `CONSENSUS_OPENCODE_AUTOSTART=0`. The graph command never auto-starts it.

Current OpenCode server docs also expose `parentID` and `/session/:id/children`; those relationships are reserved for a later explicit parent/subagent graph edge rather than inferred in version 1.

### Claude Code

Claude activity and graph history require hooks. Point each selected event at:

```text
node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event
```

Recommended graph events:

- Events that do not support matchers: `UserPromptSubmit`, `MessageDisplay`, `PostToolBatch`, `TaskCreated`, `TaskCompleted`, and `Stop`.
- Configure `StopFailure` and `SessionEnd` without a matcher for full coverage, or use their supported matcher fields when narrowing coverage.
- Use matcher `"*"` for broad coverage of `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`, `SubagentStart`, and `SubagentStop`.

Claude Code can emit several `MessageDisplay` calls for one assistant message. Consensus treats partial batches as activity but retains only the final batch marker. It does not retain the message delta.

`UserPromptSubmit` is the canonical turn boundary. `UserPromptExpansion` can still update live activity, but Consensus does not retain it as a second prompt node because direct slash-command expansion occurs inside the submitted turn.

The local Claude metadata log stores event type, session ID, timestamp, an opaque working-directory key, and small hook labels such as tool or agent type. It does not store prompts, assistant text, message deltas, tool inputs, tool outputs, transcript paths, task descriptions, or error details. Disable it with `CONSENSUS_CLAUDE_EVENT_LOG=0`.

## Configuration

The main settings are:

- `CONSENSUS_HOST` — bind address, default `127.0.0.1`.
- `CONSENSUS_PORT` — HTTP port, default `8787`.
- `CONSENSUS_POLL_MS` — process scan interval.
- `CONSENSUS_CODEX_HOME` — Codex home directory.
- `CONSENSUS_OPENCODE_HOST` / `CONSENSUS_OPENCODE_PORT` — OpenCode server address.
- `CONSENSUS_OPENCODE_AUTOSTART=0` — disable dashboard autostart.
- `CONSENSUS_REDACT_PII=0` — disable normal text redaction. Opaque graph IDs remain opaque.
- `CONSENSUS_CLAUDE_EVENT_LOG` — Claude metadata log path, or `0` to disable.
- `CONSENSUS_CLAUDE_EVENT_LOG_MAX_BYTES` — bounded log size, default 1 MiB.

See [`docs/configuration.md`](docs/configuration.md) for the complete list.

## Utilities

```bash
npm run scan
npm run graph
npm run tail -- <session.jsonl>
```

## Tests

```bash
npm run test
npm run test:ui
npm run build
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/configuration.md`](docs/configuration.md)
- [`docs/cli.md`](docs/cli.md)
- [`docs/graphs-and-loops.md`](docs/graphs-and-loops.md)
- [`docs/data-inventory.md`](docs/data-inventory.md)
- [`docs/threat-model.md`](docs/threat-model.md)
- [`docs/testing.md`](docs/testing.md)
- [`docs/troubleshooting.md`](docs/troubleshooting.md)

## License

Apache-2.0. See [`LICENSE`](LICENSE).
