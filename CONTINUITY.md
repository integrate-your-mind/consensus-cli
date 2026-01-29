Goal (incl. success criteria):
- Maintain Codex session detection and reduced flicker with current changes.
- Tests/build pass after changes.

Constraints/Assumptions:
- Keep dependencies minimal; no heavy frameworks.
- No non-trivial tests unless explicitly requested (explicit tests requested in current plan).
- Must maintain CONTINUITY.md each turn; responses begin with Ledger Snapshot.

Key decisions:
- None yet; need repro + diagnosis.

State:
  - Done:
    - OpenCode/Claude lastActiveAt preservation implemented and tests updated (from prior session).
    - Codex sustained CPU activation fixed (no longer gated by activity signal).
    - Removed unused Kimi modules/tests (activity/config/scanner/core + related tests).
    - Ran `node --test --import tsx tests/unit/codexState.test.ts` (pass).
    - Ran `npm test` (pass).
    - Ran `npm run build` (pass).
    - Committed changes: `6f8d645`.
    - Recorded UI during work: `/Users/romanmondello/consensus/tmp/codex-flicker-before.webm`.
    - Codex flicker fix applied (cpu passthrough) and tests updated; tests/build passed.
    - User reports Codex sessions are working now.
  - Now:
    - Await user direction on whether to keep changes and commit/push.
  - Next:
    - None unless user requests.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `CONTINUITY.md`
- `src/codexState.ts`
- `tests/unit/codexState.test.ts`
- `/Users/romanmondello/consensus/tmp/codex-flicker-before.webm`
