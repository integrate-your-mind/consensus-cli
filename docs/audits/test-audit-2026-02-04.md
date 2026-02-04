# Test Audit (2026-02-04)

Scope: `tests/unit/*.test.ts`, `tests/integration/*.test.ts`.

## Summary
- Primary risk: several tests assert behavior using duplicated parsing logic or shared global state, which can mask production regressions.
- Flakiness risk: time-based loops and wall-clock `Date.now()` usage without deterministic control.
- Security/PII coverage is narrow (home dir + email only); no tests for API keys, tokens, or mixed-case patterns.
- Environment specificity: multiple tests hardcode macOS paths (`/Users/...`) without Windows/Linux equivalents.
- Readability/FP: some tests mutate global process state or depend on global singletons, reducing test purity.

## Findings (By Category)

### Production-Validation Gaps
1. `tests/unit/opencodeSessionActivity.test.ts` mirrors production parsing logic instead of exercising the real implementation. This can pass even if production code changes or regresses. Consider calling the production parser directly or exporting a shared pure helper. Lines 4-99. (Production validation)
2. `tests/unit/codexEventStore.test.ts` uses a singleton `codexEventStore` shared across tests; state leaks between tests are possible and the “thread isolation” test clears state conditionally, which is not a full reset. Lines 3, 6-162. (Production validation, FP best practice)
3. `tests/integration/opencodeActivity.test.ts` and `tests/integration/opencodeSessionActivity.test.ts` mostly validate mock HTTP responses; they do not validate retry/backoff behavior or error handling beyond status/text. This is acceptable but leaves gaps for production failure modes like partial JSON or truncated bodies. (Production validation, security)

### Hallucination/Over-Summarization Risk
1. `tests/integration/codexLogs.test.ts` validates summary fields for known events but does not assert that summaries remain empty for unknown event types or malformed payload shapes. This can allow summarizers to invent content. Consider adding tests that assert `summary.*` remains `undefined` when no known signals exist. Lines 9-120, 535-629. (Hallucination checks)
2. `tests/unit/opencodeEvents.test.ts` asserts summary fields for known events but does not test that unrelated event types do not populate summaries. Add negative tests to guard against accidental inference. Lines 31-109. (Hallucination checks)

### Security Audit Coverage
1. `tests/unit/redact.test.ts` only covers home-directory and email redaction. Missing tests for API keys, tokens (e.g. `sk-`, `sk-ant-`), bearer headers, IP addresses, and Windows paths. Add comprehensive coverage for common secrets and mixed-case patterns. Lines 5-8. (Security)
2. `tests/integration/codexLogs.test.ts` includes reasoning payloads and validates “thinking” redaction but does not assert that raw `encrypted_content` or `summary` text is never surfaced in summaries. Add explicit assertions for absence. Lines 535-566. (Security, hallucination)

### Environment-Specific Assumptions
1. `tests/integration/codexLogs.test.ts` hardcodes macOS paths (`/Users/alice/...`) when asserting redaction to `~/...`. Consider parametrizing to accept Linux (`/home/...`) and Windows (`C:\Users\...`) or using `os.homedir()` to build inputs. Lines 15-28, 54-56. (Environment specificity)
2. `tests/unit/redact.test.ts` uses `/Users/alice/...` only; no Windows/Linux path validation. Lines 5-8. (Environment specificity)

### Flakiness / Time Dependence
1. `tests/integration/codexLogs.test.ts` includes a real-time polling loop with `Date.now()` + `setTimeout`, which is sensitive to CI load and can cause flakiness. Replace with deterministic time control (mock clock) or short-circuit the loop using synthetic timestamps. Lines 631-675. (Stability)
2. Multiple tests use `Date.now()` without deterministic control for expected timestamps. Prefer fixed timestamps to keep tests hermetic. Examples: `tests/unit/claudeEvents.test.ts` (lines 8-88), `tests/integration/opencodeActivity.test.ts` (lines 24-205). (Stability)

### Readability / Naming / FP Practices
1. `tests/unit/claudeState.test.ts` has a name/expectation mismatch: “marks active” but asserts `idle`. Rename to match intent or adjust assertion. Lines 10-16. (Readability)
2. `tests/integration/codexLogs.test.ts` mutates global `Date.now` and environment variables across tests. Most are restored, but this style weakens FP isolation. Prefer injecting a clock or wrapper function into the unit under test. Lines 740-1070. (FP best practice)
3. `tests/unit/codexEventStore.test.ts` relies on mutating global store state across tests rather than using a fresh store per test (impure). Consider a factory or reset method for the event store. Lines 3-162. (FP best practice)

## File-by-File Notes

### `tests/unit/opencodeSessionActivity.test.ts`
- Lines 38-99: duplicate parsing logic; tests validate the test copy, not production behavior. Risk of false positives if production changes. (Production validation)
- Lines 105-341: good coverage of edge cases, but consider using real API parsing helper to avoid divergence. (Readability)

### `tests/unit/codexEventStore.test.ts`
- Lines 3-162: shared singleton state across tests; “thread isolation” cleanup is partial and depends on prior state. Recommend adding a reset or building a fresh store for each test. (FP best practice)

### `tests/unit/claudeState.test.ts`
- Lines 10-16: name suggests active state but asserts idle; rename test or update expectation. (Readability)

### `tests/unit/redact.test.ts`
- Lines 5-8: only tests macOS home directory and email. Add token/key/IP/redaction and Windows/Linux paths. (Security, environment)

### `tests/integration/codexLogs.test.ts`
- Lines 15-28: macOS-specific paths; add cross-platform coverage. (Environment)
- Lines 535-566: redaction test does not assert that sensitive fields are not leaked. (Security)
- Lines 631-675: time-based loop can be flaky; use deterministic clock. (Stability)
- Lines 740-1070: `Date.now` and env mutation; consider clock injection for FP isolation. (FP)

### `tests/integration/opencodeActivity.test.ts` and `tests/integration/opencodeSessionActivity.test.ts`
- Time-dependent `Date.now()` values (lines 24-205 / 41-120). Deterministic timestamps would improve stability. (Stability)

## Recommendations
- Extract shared parsing helpers in production code and import them in tests to avoid logic drift.
- Introduce a test-only clock wrapper or dependency injection to eliminate `Date.now` and sleep loops.
- Add redaction tests for API keys, bearer tokens, IPs, and Windows/Linux paths.
- Add negative tests to ensure summaries remain empty for unknown event types.
- Use fresh instances or reset methods for shared singleton stores to keep tests pure.
