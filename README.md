# consensus-cli

[![npm](https://img.shields.io/npm/v/consensus-cli.svg?color=0f766e)](https://www.npmjs.com/package/consensus-cli)
[![GitHub release](https://img.shields.io/github/v/release/integrate-your-mind/consensus-cli?display_name=tag&color=2563eb)](https://github.com/integrate-your-mind/consensus-cli/releases)
[![License](https://img.shields.io/npm/l/consensus-cli.svg?color=6b7280)](LICENSE)

Local-first observability for coding-agent graphs, loops, and live activity.

## Status

Beta. Local-only, with no hosted service.

## Core use cases

- Inspect observed prompt, model, tool, command, and edit transitions.
- Detect cycles inside individual observed turns.
- Track active, idle, and error states across local coding agents.
- Compare evidence depth across different agent harnesses.
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

Consensus reads local runtime evidence and does not require an OpenAI API key.

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
- Detects strongly connected components only within one agent and turn segment.
- Applies live state only to the latest observed step. Historical loops remain idle.
- Reports `transitionObservations`, which counts internal transition evidence rather than claiming completed loop iterations.

Raw session paths are not included in graph IDs. See [`docs/graphs-and-loops.md`](docs/graphs-and-loops.md) for the full contract.

## Harness coverage

List the registry and evidence tiers:

```bash
npx consensus-cli harnesses
npx consensus-cli harnesses --json
npx consensus-cli harnesses --setup gemini
npx consensus-cli harnesses --setup copilot
```

The registry includes:

- Codex, OpenCode, and Claude Code.
- OpenClaw, Hermes Agent, Kimi Code, Factory Droid, Gemini CLI, Qwen Code, and GitHub Copilot CLI.
- Cursor Agent, Warp Oz, MiniMax CLI, Antigravity, Aider, Goose, Amp, Amazon Q, Kiro, and OpenHands.
- Cline, Roo Code, Windsurf Cascade, JetBrains Junie, Replit Agent, and Zed Agent.

Consensus distinguishes process discovery from event-level support. Exact process recognition does not imply a complete graph. Each harness reports one of these evidence tiers: native events, hooks, structured stream, remote API, process only, tool only, or manual bridge.

The enriched snapshot path used by `npm run scan` and `consensus graph` performs exact executable discovery for supported local harnesses. It does not search prompt text for provider names. See [`docs/harness-providers.md`](docs/harness-providers.md) for the provider matrix and adapter limits.

## Shared metadata-only hooks

The shared collector supports Claude-compatible or mapped lifecycle hooks for:

```text
claude
hermes
kimi
factory
gemini
qwen
copilot
```

Run it as the provider's command hook:

```text
node /path/to/consensus-cli/dist/harnessHook.js <harness-id>
```

The collector accepts provider JSON on standard input and writes normalized metadata to `~/.consensus/harness-events.jsonl` by default.

It does not retain prompt text, assistant text, tool input or output, shell commands, raw working directories, raw session or turn identifiers, or error details. Gemini CLI and GitHub Copilot CLI receive a compact one-line `{}` acknowledgment because their hook contracts require valid JSON on standard output; passive command-hook providers remain silent.

Hook session assignment fails closed when several sessions share the same working directory. Exact opaque session keys take priority; cwd fallback is used only when one session matches.

## Provider data flow

1. Scan specialized Codex, OpenCode, and Claude Code process/session sources.
2. Read bounded Codex JSONL summaries and notify events.
3. Read OpenCode sessions and SSE events from the local server.
4. Receive Claude and shared multi-harness hook metadata.
5. Discover additional exact local harness executables without exporting command payloads.
6. Correlate processes and hook sessions with opaque keys.
7. Derive turn-scoped execution graphs and detected cycles.

### Codex

`consensus setup` writes the notify command to the user-level `~/.codex/config.toml`.

```bash
npx consensus-cli setup
```

### OpenCode

Consensus reads the local OpenCode HTTP server and its SSE event streams. The dashboard may auto-start `opencode serve` unless `CONSENSUS_OPENCODE_AUTOSTART=0`. The graph command never auto-starts it.

Current OpenCode server docs also expose `parentID` and `/session/:id/children`; those relationships are reserved for a later explicit parent/subagent graph edge rather than inferred in version 1.

### Claude Code

Claude activity and graph history require hooks. The existing HTTP collector remains available:

```text
node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event
```

The shared standalone collector can also normalize Claude metadata through `harnessHook.js claude`.

Claude Code can emit several `MessageDisplay` calls for one assistant message. Consensus treats partial batches as activity but retains only the final batch marker. It does not retain the message delta.

`UserPromptSubmit` is the canonical turn boundary. `UserPromptExpansion` can update live activity, but Consensus does not retain it as a second prompt node.

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
- `CONSENSUS_HARNESS_EVENT_LOG` — shared harness metadata log path, or `0` to disable.
- `CONSENSUS_HARNESS_EVENT_LOG_MAX_BYTES` — shared log byte bound, default 2 MiB.
- `CONSENSUS_HARNESS_EVENT_TTL_MS` — shared event retention window.
- `CONSENSUS_HARNESS_INFLIGHT_TIMEOUT_MS` — shared hook in-flight timeout.
- `CONSENSUS_GENERIC_PROCESS_CACHE_MS` — generic process discovery cache, default 1000 ms.

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
- [`docs/harness-providers.md`](docs/harness-providers.md)
- [`docs/data-inventory.md`](docs/data-inventory.md)
- [`docs/threat-model.md`](docs/threat-model.md)
- [`docs/testing.md`](docs/testing.md)
- [`docs/troubleshooting.md`](docs/troubleshooting.md)

## License

Apache-2.0. See [`LICENSE`](LICENSE).
