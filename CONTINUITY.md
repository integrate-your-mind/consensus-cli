Goal (incl. success criteria):
- Fix Codex sustained CPU activation bug (sustained should not require activity signal).
- Remove unused Kimi modules/tests (activity/config/scanner/core dirs + related tests).
- All unit/integration tests and build pass after cleanup.

Constraints/Assumptions:
- Keep dependencies minimal; no heavy frameworks.
- No non-trivial tests unless explicitly requested (explicit tests requested in current plan).
- Must maintain CONTINUITY.md each turn; responses begin with Ledger Snapshot.

Key decisions:
- Follow user plan: fix Codex sustained CPU gating, then remove unused modules, then verify.

State:
  - Done:
    - OpenCode/Claude lastActiveAt preservation implemented and tests updated (from prior session).
    - Codex sustained CPU activation fixed (no longer gated by activity signal).
    - Removed unused Kimi modules/tests (activity/config/scanner/core + related tests).
    - Ran `node --test --import tsx tests/unit/codexState.test.ts` (pass).
    - Ran `npm test` (pass).
    - Ran `npm run build` (pass).
  - Now:
    - Ready for review/commit.
  - Next:
    - None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `CONTINUITY.md`
- `src/codexState.ts`
- `tests/unit/codexState.test.ts`
- `src/activity/` (directory removal)
- `src/config/` (directory removal)
- `src/scanner/` (directory removal)
- `src/core/` (directory removal)
- `tests/unit/activityMachine.test.ts`
- `tests/integration/codexActivityLatency.test.ts`
