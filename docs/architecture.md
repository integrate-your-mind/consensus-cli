# Architecture

## Live data flow

1. `scan.ts` enumerates Codex, OpenCode, and Claude Code processes.
2. `codexLogs.ts` reads bounded recent JSONL summaries.
3. `opencodeEvents.ts` consumes the local OpenCode SSE stream.
4. `server.ts` validates Codex notify and Claude hook payloads.
5. `services/claudeEvents.ts` keeps bounded hook summaries in memory and writes metadata-only cross-process history.
6. `server.ts` emits snapshots over WebSocket.
7. `public/src` renders the live isometric view.

## One-shot scan and graph flow

1. `scanSnapshot.ts` hydrates bounded Claude metadata from disk.
2. It runs the normal process scanner.
3. `claudeSnapshot.ts` attaches retained Claude hook summaries to matching Claude agents.
4. `cli/graph.ts` disables OpenCode autostart before dynamically importing the scan wrapper.
5. `graph.ts` builds opaque agent nodes and turn-scoped step nodes.
6. `graphLoops.ts` detects strongly connected components inside the resulting transition graph.

## Main components

- Express and `ws` local server.
- Provider adapters for Codex, OpenCode, and Claude Code.
- Event-driven activity state derivation with bounded caches.
- Versioned graph and loop analysis.
- React/Vite client with canvas rendering.

## Design boundaries

- Read-only graph inspection.
- No inferred cross-agent causality in version 1.
- No prompt, assistant-message, or tool-output persistence in Consensus-owned Claude metadata.
- No raw session paths in graph relationship IDs.
