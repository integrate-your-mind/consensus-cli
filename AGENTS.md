# Agent instructions (scope: this directory and subdirectories)

## Scope and layout
- **This AGENTS.md applies to:** repo root and all subdirectories.
- **Key directories:**
  - `src/`: TypeScript server + scan/tail utilities.
  - `public/`: static client (canvas renderer).
  - `dist/`: build output (generated).

## Project overview
- Node 20+ and TypeScript.
- Express + ws server that serves a canvas UI and pushes snapshots over WebSocket.
- No frontend frameworks; keep client code in plain JS modules.

## Commands
- **Install:** `npm install`
- **Dev:** `npm run dev`
- **Build:** `npm run build`
- **Start:** `npm start`

## Conventions
- Keep dependencies minimal and avoid heavy frameworks.
- Prefer small, readable functions over abstracted layers.
- Use best-effort parsing for Codex logs; failures must not crash the server.
- Follow `docs/constitution.md` for OSS and release discipline.

## Verification
- Default: `npm run build` for type-checking.

## Configuration
- `CONSENSUS_HOST`, `CONSENSUS_PORT`, `CONSENSUS_POLL_MS`, `CONSENSUS_CODEX_HOME`, `CONSENSUS_PROCESS_MATCH`, `CONSENSUS_REDACT_PII`.

## Do not
- Add non-trivial tests unless explicitly requested.
- Introduce large UI frameworks or build tooling.
