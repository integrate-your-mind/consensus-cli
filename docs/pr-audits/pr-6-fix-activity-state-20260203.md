# PR Audit: fix(activity): stabilize codex and opencode states (PR #6)

Branch: fix/activity-state
Audit Branch: audit/pr-6-fix-activity-state-20260203
Base: main

## Scope
- Full diff audit for PR #6 as fetched locally.
- Goals: reduce code size, time complexity, memory use, and document tradeoffs.

## Summary Of Findings
- No functional regressions identified in the diff as applied to activity state.
- Primary opportunities: remove duplicate status parsing in OpenCode session handling and avoid repeated regex evaluations.
- Implemented: consolidated status parsing via `deriveStatusFlags` to reduce code size and repeated regex checks.

## Changes Applied In Audit Branch
- src/scan.ts: replace repeated inline status regex checks with `deriveStatusFlags` helper.

## Detailed Audit Notes

### src/scan.ts
- Lines around status authority checks: duplicated status parsing existed for both main session handling and subagent handling.
  - Risk: inconsistent future updates if new status terms are added.
  - Change: centralize parsing to reduce code and maintain a single regex set.
  - Complexity: O(1) per call; reduces constant factors by reusing helper.
  - Memory: negligible; helper returns small object and reduces duplicated regex literals.
  - Tradeoff: introduces small helper allocation; clarity and DRY preferred.

- Subagent status parsing: same regex set used in subagent block.
  - Change: use `deriveStatusFlags` for consistent behavior.
  - Tradeoff: minor object creation vs repeated regex checks; acceptable for clarity and maintainability.

## Recommendations Not Implemented
- Consider turning status regexes into precompiled constants to avoid re-allocations if this hot path becomes a bottleneck.
- Consider caching per-session status flags if status strings do not change frequently (requires careful invalidation).

## Verification
- Not run (not requested).
