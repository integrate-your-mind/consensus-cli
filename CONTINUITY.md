Goal (incl. success criteria):
- Restore correct active/idle/offline for Codex/OpenCode/Claude (no flicker, no stale active).
- Ensure side lane lists only real running sessions (no ghost updates).
- Preserve UI fidelity; migrate architecture only if required.
- Windows support remains correct end-to-end.
- Customer-facing: Codex CLI must start/working/stop instantly (no animation hang, no lag).

Constraints/Assumptions:
- Preserve current UI fidelity.
- All observability via Effect integrations; no ad-hoc OTel calls.
- Keep dependencies minimal; no heavy frameworks beyond Next.js/React.
- Single deployment preferred; WebSocket may use a Worker/Durable Object route.
- No non-trivial tests unless explicitly requested.
- Must maintain CONTINUITY.md each turn; responses begin with Ledger Snapshot.

Key decisions:
- Focus on session correctness + Windows support first; refactor only if required.
- Pause migrations; fix customer-facing issues first.
- Auth later via browser login (`--login`) to provision a machine token.
- Protocol encoding: start with JSON deltas + envelope; negotiate `enc` to allow protobuf later.
- Cadence: DO→dashboards max 5 Hz (200ms tick, coalesce); agents event-driven + 1 Hz heartbeat (cap 10 Hz).
- /ws can route to a Durable Object under OpenNext via custom worker entrypoint (single deployment).

State:
  - Done:
    - Decision: prioritize customer fixes (session validation + Windows support).
    - Added Windows start-time lookup (PowerShell/WMI) and cmd-based cwd inference fallback.
    - Reset activity cache when process start time changes (prevents stale active on PID reuse).
    - Windows-aware codex detection (codex.exe + backslash vendor paths) to avoid false positives.
    - Strip quotes when parsing session IDs (Codex/OpenCode) to improve Windows command parsing.
    - Tightened codex process matching to avoid `.codex` shell snapshot false positives.
    - Exclude codex vendor processes by default (reduce stale sessions); allow opt-in via CONSENSUS_INCLUDE_CODEX_VENDOR.
    - Added stale-active TTL caps for codex/opencode (CONSENSUS_CODEX_STALE_ACTIVE_MS / CONSENSUS_OPENCODE_STALE_ACTIVE_MS); defaults now 5s.
    - Codex activity candidates include lastEvent/lastIngest again to prevent missing active tiles (bounded by stale TTL).
    - OpenCode: avoid dir-based session mapping when multiple TUIs share a cwd (prevents wrong-session flip).
    - OpenCode/Codex: clear activity signals on explicit end events and in-flight timeout to drop to idle immediately.
    - Codex: activity window no longer driven by lastEvent/lastIngest timestamps.
    - OpenCode: ignore lastEventAt as activity when lastActivityAt missing (fixes unit test expectation).
    - OpenCode events: treat activity timestamp as parsed ts or now to avoid missing activity.
    - `node --test --import tsx tests/unit/opencodeState.test.ts` passes.
    - `npm run build` passes.
    - WS protocol v1 handshake added (hello/welcome) with snapshot/delta envelopes (server + client).
    - Server now computes per-snapshot deltas (upsert/remove/meta/ts) and sends to negotiated clients.
    - Client now sends hello, accepts snapshot/delta, and applies delta ops to local state.
    - Codex activity: removed lastEvent/lastIngest as activity signals in scan (use lastActivityAt only).
    - OpenCode activity: CPU-only activation disabled unless there is activity/inFlight; stale TTL uses lastActivityAt only.
    - Visual test recording captured for Codex run (./tmp/consensus-activity.webm).
    - `opencode run` failed to connect to local server (error: unable to connect).
    - `claude -p` failed due to missing login (account access required).
    - Codex CPU-only activation disabled unless there is recent activity/inFlight (codexState).
    - Codex in-flight timeout default raised to 15s (codexLogs) to avoid premature idle.
    - Codex event active default set to 1000ms; stale TTL default set to 5000ms (scan).
    - Codex-only 60s visual recording captured (./tmp/consensus-codex-60s.webm).
    - Codex verification recording captured via agent-browser (./tmp/consensus-codex-verify.webm) + screenshot (./tmp/consensus-codex-verify.png).
    - Git history for codex-related files between v0.1.3..HEAD captured (commits: e34456f, 1d032ae, 5090b53, 2ef7a9a).
    - Codex logs: treat `agent_message` as hard turn end (clear openCallIds + inFlight) and reduce default inflight timeout to 5s for faster stop.
    - Codex logs: remove `canSignal` guard for `agent_message` end so completion clears immediately.
    - Codex verification recording captured after changes (./tmp/consensus-codex-verify-2.webm) + screenshot (./tmp/consensus-codex-verify-2.png).
    - Codex verification recording captured after removing agent_message canSignal guard (./tmp/consensus-codex-verify-3.webm) + screenshot (./tmp/consensus-codex-verify-3.png).
    - Inspected Kimi fixes zip at /Users/romanmondello/Downloads/Kimi_Agent_代理状态管理错误修复.zip; extracted files to /tmp/kimi_fixes for diff.
    - Kimi diffs identified: codexState CPU-only sustained activation; stateStore stale timer clears spans for present agents; codexActivity progress uses current ts; adds tests/unit/stateStore.test.ts.
    - Applied Kimi changes: stateStore stale timer clears spans for present agents; codexActivity span.progress uses current ts. Skipped codexState CPU-only activation.
    - CodexState updated to fully disable CPU-only activation (remove sustainedCpu gating).
    - Created backup branch `backup/local-changes-20260128-222335` and saved diff to `/tmp/our-changes.patch`.
    - User confirmed Codex behavior is stable (no animation hang).
    - Attempted `git pull origin init-oss` but blocked by uncommitted local changes (pull aborted).
  - Now:
    - Create a backup branch and commit all current work so nothing is lost.
    - Document which files to keep vs overwrite for the upcoming merge.
    - Pull `origin/init-oss`, resolve conflicts, and re-apply local enhancements as needed.
    - Re-validate build/tests after merge.
  - Next:
    - Re-validate UI behavior post-merge (no flicker; accurate active counts, no ghost sessions).
    - After Codex is correct post-merge, move to other providers (OpenCode/Claude).
    - Revisit architecture migration only if correctness cannot be achieved.

Open questions (UNCONFIRMED if needed):
- Repro: exact steps for bad start/stop in UI (which tool, which actions).
- Which commit/tag currently deployed when regression observed (if not HEAD)?
- Which platforms/tools should be included in the visual run now (Codex only confirmed). (UNCONFIRMED)
- How to trigger “think for 60 seconds” in Codex (prompt text ok). (UNCONFIRMED)
- Which tmux session/window/panes map to Codex/OpenCode/Claude? (UNCONFIRMED)

Working set (files/ids/commands):
- `src/scan.ts`
- `src/codexLogs.ts`
- `src/codexState.ts`
- `src/opencodeState.ts`
- `src/opencodeEvents.ts`
- `src/claudeCli.ts`
- `public/app.js`
- `src/server.ts`
- `package.json`
- `CONTINUITY.md`
- `tests/unit/opencodeState.test.ts`
- `tmux consensus-cli-#3:test-watch` (running `npm run test:watch`)
- `./tmp/consensus-activity.webm`
- `./tmp/consensus-activity.png`
- `./tmp/consensus-codex-60s.webm`
- `./tmp/consensus-codex-60s.png`
