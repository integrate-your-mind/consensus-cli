# Harness providers

Consensus models the **agent harness or runtime** separately from the model provider.

Examples:

- `openai`, `anthropic`, `minimax`, and `moonshot` may provide models or tools.
- Codex, Claude Code, OpenClaw, Hermes, Kimi Code, Cursor Agent, Factory Droid, and Warp Oz provide execution loops or agent surfaces.

This distinction prevents a MiniMax model used inside OpenClaw from being reported as a separate agent loop unless a distinct MiniMax runtime is actually running.

## Coverage levels

Consensus reports coverage by evidence source rather than a single supported flag:

- **Native events:** structured local runtime, server, RPC, or log events.
- **Hooks:** lifecycle callbacks configured in the harness.
- **Structured stream:** machine-readable CLI output attached to a run.
- **Remote API:** run status and history fetched from a hosted agent service.
- **Process only:** the local process is visible, but no step history is attached.
- **Tool only:** the process supplies a model or tool to another harness rather than owning the loop.
- **Manual:** an IDE or extension adapter is required; process matching would be unreliable.

## Current registry

| Harness | Class | Best evidence source | Current Consensus depth |
| --- | --- | --- | --- |
| Codex | Local CLI/runtime | Notify events and bounded local session records | Event graph |
| OpenCode | Local server/TUI | HTTP API and SSE event streams | Event graph |
| Claude Code | Local CLI | Lifecycle hooks | Event graph |
| OpenClaw | Local server/runtime | Gateway RPC run, tool, assistant, and lifecycle streams | Process discovery; native adapter next |
| Hermes Agent | Local CLI/gateway | Gateway, plugin, and shell hooks | Process discovery; hook adapter next |
| Kimi Code | Local CLI | Lifecycle hooks | Process discovery; hook adapter next |
| MiniMax CLI | Tool/model integration | CLI invocation inside another harness | Tool-only discovery |
| Cursor Agent | Local CLI/remote agent | Partial hooks and `stream-json` CLI output | Process discovery; stream adapter next |
| Warp Oz | Local and remote agent | Oz API/SDK run status and transcripts | Process discovery; remote API adapter next |
| Factory Droid | Local CLI | Lifecycle hooks | Process discovery; hook adapter next |
| Qwen Code | Local CLI | Command or HTTP lifecycle hooks | Process discovery; hook adapter next |
| Gemini CLI | Local CLI | No Consensus event adapter yet | Process discovery |
| Antigravity CLI | Local CLI | No Consensus event adapter yet | Process discovery |
| GitHub Copilot CLI | Local CLI | No Consensus event adapter yet | Process discovery |
| Aider | Local CLI | No Consensus event adapter yet | Process discovery |
| Goose | Local CLI | No Consensus event adapter yet | Process discovery |
| Amp | Local CLI | No Consensus event adapter yet | Process discovery |
| Amazon Q Developer | Local CLI | No Consensus event adapter yet | Process discovery |
| Kiro | Local CLI/IDE | No Consensus event adapter yet | Process discovery |
| OpenHands | Local or hosted runtime | Runtime/API integration needed | Process discovery |
| Cline | IDE extension | Extension adapter | Registry only |
| Roo Code | IDE extension | Extension adapter | Registry only |
| Windsurf Cascade | IDE agent | IDE adapter | Registry only |
| JetBrains Junie | IDE agent | IDE adapter | Registry only |
| Replit Agent | Remote agent | Remote API adapter | Registry only |
| Zed Agent | IDE agent | IDE adapter | Registry only |

## Process discovery contract

The one-shot snapshot and graph commands detect exact executable names. They do not search arbitrary prompt text for provider names.

Examples:

- `openclaw gateway` becomes `openclaw-server`.
- `openclaw agent` becomes `openclaw-cli`.
- `hermes gateway` becomes `hermes-server`.
- `oz agent run` becomes `warp-cli`; unrelated `oz` commands are ignored.
- `q chat` becomes `amazon-q-cli`; unrelated `q` processes are ignored.
- Cursor detection uses `cursor-agent`; the generic executable name `agent` is not matched.

Generic detections carry no synthetic step events. Their graph coverage is therefore explicit about being process-only, tool-only, hook-ready, stream-ready, or remote-API-ready.

## Adapter order

1. **Shared hook adapter:** Claude-style lifecycle JSON covers Kimi Code, Factory Droid, and Qwen Code with small provider maps. Hermes uses a related hook surface and can feed the same normalized event model through a provider-specific translator.
2. **OpenClaw adapter:** consume Gateway RPC lifecycle, assistant, and tool streams keyed by `runId` and session.
3. **Cursor adapter:** ingest `--output-format stream-json` for headless runs and use supported CLI hooks where available.
4. **Warp adapter:** read Oz run status, transcripts, and metadata through the official API/SDK.
5. **IDE adapters:** add explicit extension bridges for Cline, Roo Code, Windsurf, Junie, and Zed rather than guessing from Electron helper processes.
6. **Remote adapters:** add authenticated, opt-in connectors for Replit Agent and other hosted runtimes.

## Product boundary

Consensus does not claim event-level support merely because it recognizes a process. It also does not infer that a model vendor owns the active loop. Parent, delegation, handoff, retry, approval, and cross-harness causal edges require provider evidence.

## Sources checked

Provider contracts were checked on July 19, 2026:

- Codex configuration: <https://developers.openai.com/codex/config-reference>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- OpenCode server and SSE: <https://opencode.ai/docs/server/>
- OpenClaw agent loop and runtimes: <https://docs.openclaw.ai/agent-loop> and <https://docs.openclaw.ai/concepts/agent-runtimes>
- Hermes hooks: <https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/>
- Kimi Code hooks: <https://moonshotai.github.io/kimi-code/en/customization/hooks>
- MiniMax CLI: <https://platform.minimax.io/docs/token-plan/minimax-cli>
- Cursor CLI: <https://docs.cursor.com/en/cli/using>
- Warp Oz CLI/API: <https://docs.warp.dev/reference>
- Factory Droid hooks: <https://docs.factory.ai/reference/hooks-reference>
- Qwen Code hooks: <https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/>
- Gemini CLI: <https://developers.google.com/gemini-code-assist/docs/gemini-cli>
