# Postmortem: Codex Activity Flicker (Idle/Active Oscillation)

- Date: 2026-02-05 to 2026-02-06
- Area: Codex activity detection and agent lane rendering (`/api/snapshot`, JSONL tailer, session selection)
- Symptom: "active" animation flickered off between tool calls and in the middle of a single interactive Codex session.

## Summary

Consensus was intermittently showing a Codex agent as `idle` between tool calls even though the agent was still actively running work. The user-visible symptom was UI flicker (active, idle, active) during a single assistant flight.

The primary root cause was inconsistent session log tailing caused by session file switching between scan ticks (a PID being mapped to different `*.jsonl` files over time) plus timeout/grace logic that could temporarily end `inFlight` when no new bytes were observed.

Remediation standardized on a single source of truth (Codex session JSONL tails) for `inFlight` and `lastActivityAt`, added PID-to-session pinning with safe stale release, hardened grace/timeout behavior via tests, and added evidence tooling (flicker detector + video demo) to prevent regressions.

## Timeline (Execution)

- Symptom reproduced: active animation flickered off between tool calls during a single interactive Codex session.
- Early iteration failure mode: multi-source merges (webhook + notify hook + JSONL) produced disagreement windows and flicker.
- Stabilization changes landed: JSONL tail as SSOT, PID-to-session pinning, forced tail updates for pinned sessions, and stricter end-marker handling to avoid false idle transitions.
- Validation added: a flicker poller (`scripts/flicker-detect.js`) plus env-gated Playwright demos that record a 30s video of interactive TUI sessions transitioning `idle -> active -> idle`.
- Follow-up fix (review-driven): stale session cleanup now clears all end markers/open-call tracking even when `state.inFlight` is already false, preventing ghost in-flight state from lingering.

## Impact

- UI: false negatives for "agent active" during long tool chains or during quiet gaps between tool events.
- Observability: inconsistent `inFlight` made it hard to trust snapshots, and masked real activity behind transient idle windows.

## Root Causes

1. **Session file switching across scan ticks**
   - `scanCodexProcesses` can discover multiple candidate JSONL files (session id, `lsof`, cwd heuristics).
   - Without stable pinning, the chosen file could oscillate between candidates, which reset tail offsets/state and produced apparent state changes (including `active->idle->active`).

2. **`inFlight` timeout/grace interacting with "no new bytes" periods**
   - Tool chains can have short gaps with no new session JSONL output.
   - If the tailer relies only on file freshness/bytes, those gaps can trip `pendingEndAt` paths unless explicitly suppressed by an open turn (`turnOpen`) or cleared by late-arriving activity.

3. **Attempted multi-source merge (webhook + notify graph + JSONL) introduced conflict**
   - Earlier iterations tried merging webhook-derived state, notify hook state, and JSONL tail state.
   - Codex notify hooks were not emitting the full lifecycle events required to represent multi-tool concurrency reliably, so the graph could not be SSOT.
   - The merge logic created disagreement windows that manifested as flicker.

## Contributing Factors

- "Done" was implicitly treated as "compiles and tests pass" instead of "reproduced and measured fixed".
- `/api/snapshot` historically performed synchronous scanning on each request, which made high-frequency polling both expensive and jittery for evidence collection.
- Local environment quirks during QA:
  - Codex CLI did not support `--skip-git-repo-check` (early tmux runs exited immediately).
  - tmux `base-index` was `1`, so targeting `session:0.0` failed until switching to name-based targets.

## Remediation (What Changed)

### Single Source of Truth

- SSOT: Codex session JSONL tail (`summarizeTail(...)` in `src/codexLogs.ts`) is authoritative for:
  - `inFlight`
  - `lastActivityAt`
- Webhook/notify inputs only trigger faster scanning or attach metadata. They do not override JSONL-derived state.
  - See `docs/data-flow.md`.

### Session Pinning and Selection Stability

- PID-to-session pinning prevents mid-run session switching.
- Explicit session signals (session id mapping, cwd-derived session) take priority over cached pinning.
- Pins are released only on safe stale conditions (mtime too old, file missing, PID restart).
  - See `docs/session-selection.md`.

### Timeout/Grace Hardening

- Added focused tests for the `pendingEndAt` timeout path and `turnOpen` suppression.
  - `tests/unit/stateTimeout.test.ts`

### Snapshot Endpoint for High-Frequency Polling

- `/api/snapshot` returns cached snapshots by default to support 250ms pollers safely.
- `?mode=full` runs a bounded full scan; `?refresh=1` requests a scan tick without blocking the response.
  - `src/server.ts`
  - `docs/api-authentication.md`

### Evidence Tooling

- `scripts/flicker-detect.js`:
  - Polls `/api/snapshot` at 250ms, logs transitions, computes flicker (`active->idle->active` within a window).
  - Writes both a JSON summary and a JSONL transition log.
- Playwright demos (manual, env-gated):
  - `e2e/ui/codexTuiLiveDemo.pw.ts` (interactive Codex TUI sessions via tmux; video capture via `PW_VIDEO=1`)
  - `e2e/ui/codexActivityDemo.pw.ts` (mock mode demo for video capture; deterministic)

## Validation and Evidence

### Automated gates

- Build gate: `npm run build`
- Regression gate: `npm test` (unit + integration)
- Evidence gate: flicker detector + video demo (paths are gitignored; reproduction commands are below).

### Reproduction commands

Flicker detector:

```bash
node scripts/flicker-detect.js --interval-ms 250 --duration-ms 120000 --window-ms 10000 \
  --out tmp/flicker-summary.json --out-jsonl tmp/flicker-summary.transitions.jsonl
```

Interactive TUI video demo (manual):

```bash
RUN_LIVE_CODEX=1 PW_VIDEO=1 CONSENSUS_PROCESS_MATCH=consensus-tui-demo- \
  CONSENSUS_OPENCODE_EVENTS=0 CONSENSUS_OPENCODE_AUTOSTART=0 \
  npx playwright test e2e/ui/codexTuiLiveDemo.pw.ts
```

### Example artifacts (local paths, gitignored)

- Flicker summary:
  - `tmp/flicker-summary.json`
  - `tmp/flicker-summary.transitions.jsonl`
- Demo video:
  - Raw Playwright video under `test-results/**/video.webm`
  - 30s share artifact under `tmp/` (example: `tmp/codexTuiLiveDemo-30s.mp4`)

## Follow-ups

- Consider adding a CI lane that runs `scripts/flicker-detect.js` against mock mode (deterministic) to gate future flicker regressions.
- Keep the "Completion protocol" in `AGENTS.md` enforced: evidence artifacts are required for state-change fixes.
