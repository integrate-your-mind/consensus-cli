# Architecture

## Data flow
1) `scan.ts` enumerates OS processes and collects CPU/memory stats.
2) `codexLogs.ts` scans `CODEX_HOME/sessions/` for recent JSONL logs.
3) `server.ts` ingests Codex notify + Claude hook events into in-memory stores.
4) `server.ts` polls snapshots and pushes updates over WebSocket.
5) `public/src` renders the isometric map in a canvas (see `public/src/components/CanvasScene.tsx`).

## Components
- Server: Express + ws, static assets, `/api/snapshot`, `/health`.
- Client: Canvas renderer with pan/zoom and a detail side panel.
- Log tailer: best-effort JSONL parser for "doing" summaries.
