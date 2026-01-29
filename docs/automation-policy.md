# Automation & Refactor Policy

This policy defines how automated refactors and agent workflows operate in this repo.

## Stability invariants
- No constant background cleanup while other work is in flight.
- One writer at a time. Use an explicit repo lock for automated rewrites.
- Change by unit (function/file/module), not continuous line edits.
- Hard gate: typecheck + tests must pass before commit.
- Stop on first failure. Do not “fix forward” across unrelated changes.
- Prefer repeatable states: preserve a clean before/after for debugging.

## Automation window
- Only run when the working tree is clean and no other agents are writing.
- Acquire an exclusive repo lock for the full run.
- Release the lock after passing checks and committing.

## Agent workflow (stable units)
### Phase 0 — preflight (mandatory)
- Verify clean working tree and no other writers.
- Acquire repo lock.
- Snapshot baseline (HEAD + build/test status).

### Phase A — inventory (line-aware)
- Classify code blocks: already Effect, should be Effect, leave as-is, needs adapter.
- Record decisions in a migration ledger (jsonl or md).
- Choose the smallest coherent refactor unit.

### Phase B — doc cross-check
- Open the relevant Effect docs for APIs used in the change.
- Map exact API calls to the current code shape.

### Phase C — self-critique
- Draft two approaches:
  - Solution 1: minimal churn.
  - Solution 2: more “pure Effect”.
- Decide using a rubric:
  - correctness (typed errors + cancellation)
  - observability (span/metric coverage)
  - diff size
  - maintainability

### Phase D — implement + verify
- Apply changes by unit.
- Run the smallest relevant checks (typecheck + targeted tests).
- Stop immediately on failures; revert or fix within the same unit.
- Commit only when green and with a single reason to exist.
- Release repo lock.

## Commit policy
- Avoid per-line commits.
- Use atomic, intent-based commits (function/module/adapter/endpoint).
- If high granularity is needed, use one commit per hunk and squash before merge.
