# Architecture

## Data flow
1) `scan.ts` enumerates OS processes and collects CPU/memory stats.
2) `codexLogs.ts` scans `CODEX_HOME/sessions/` for recent JSONL logs.
3) `server.ts` polls snapshots and pushes updates over WebSocket.
4) `public/app.js` renders the isometric map in a canvas.

## Components
- Server: Express + ws, static assets, `/api/snapshot`, `/health`.
- Client: Canvas renderer with pan/zoom and a detail side panel.
- Log tailer: best-effort JSONL parser for "doing" summaries.
