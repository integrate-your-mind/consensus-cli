# Pre-Release Testing Strategy

> **CON-984** — Systematic gate-check before publishing `consensus-cli` to npm.

This document defines four progressive testing layers, each with explicit commands, pass/fail criteria, and compute cost estimates. Run them in order. A failure at any layer blocks advancement to the next.

---

## Layer 1 — Unit Tests

**Scope:** Pure function correctness. No I/O, no network, no file system.

**What is covered:**
- Activity state derivation for all three agent kinds (Claude, Codex, OpenCode)
- State machine transitions (idle ↔ active ↔ error ↔ timeout)
- Agent deduplication (same repo/cwd, distinct PID)
- PII redaction
- Layout cell-key generation
- Config interval parsing
- Session pinning logic
- Stale file cleanup logic
- Codex event state machine (JSONL parsing, in-flight tracking, tail catch-up)
- OpenCode event ingestion and session assignment
- Lane sorting pipeline

**Compute cost:** ~$0. Runs entirely in-process. CI runtime: ~8s.

### Commands

```bash
# All unit tests
npm run test:unit

# Watch mode (during development)
npm run test:watch tests/unit
```

### Pass criteria

| Criterion | Requirement |
|-----------|-------------|
| Exit code | 0 |
| Test count | ≥ 30 test files pass |
| No skipped tests | `--skip` / `todo` count = 0 |
| Duration | < 15s on CI (ubuntu-latest, Node 20) |

### Fail criteria

Any assertion failure, uncaught exception, or missing module import causes a hard block. Do not proceed to Layer 2.

### Key test files

```
tests/unit/activity.test.ts          — state derivation from CPU/events
tests/unit/activityMachine.test.ts   — state machine edge cases
tests/unit/codexState.test.ts        — CPU thresholds, in-flight tracking
tests/unit/dedupe.test.ts            — separate PIDs, collapsed identities
tests/unit/stateTimeout.test.ts      — idle-after-silence transitions
tests/unit/redact.test.ts            — PII scrubbing correctness
tests/unit/layoutCellKey.test.ts     — spatial key uniqueness
tests/unit/codexEventStore.test.ts   — JSONL event storage
```

---

## Layer 2 — Integration Tests

**Scope:** Multi-component interactions with real I/O: HTTP, WebSocket, file system, child processes.

**What is covered:**
- Full agent normalization and lane-sort pipeline (scan → normalize → sort)
- Claude hook event HTTP posting to local server
- Codex log parsing end-to-end (real JSONL files, tail catch-up, tool timeout)
- Codex notification file writing and hook delivery
- OpenCode API client HTTP requests
- OpenCode session activity tracking across restarts
- Mock snapshot server round-trip
- Live CDP (Chrome DevTools Protocol) session observation

**Compute cost:** ~$0 wall-clock cost. Some tests spin up local Express instances or write temp files. CI runtime: ~20–40s.

### Commands

```bash
# All integration tests
npm run test:integration

# Both unit + integration (CI gate command)
npm run test

# Watch mode
npm run test:watch tests/integration
```

### Pass criteria

| Criterion | Requirement |
|-----------|-------------|
| Exit code | 0 |
| Test count | ≥ 14 test files pass |
| HTTP round-trip | Server tests respond within 500ms |
| Log parsing | Malformed JSONL lines are skipped, not fatal |
| Temp file cleanup | No leftover files in /tmp after test run |

### Fail criteria

Port binding failure (check for port conflicts on 8787), file permission errors on JSONL fixtures, or any assertion failure. Do not proceed to Layer 3.

### Key test files

```
tests/integration/agentLanePipeline.test.ts    — full normalize+sort pipeline
tests/integration/claudeHook.test.ts           — hook → server HTTP round-trip
tests/integration/codexLogs.test.ts            — JSONL parsing + tail summarization
tests/integration/codexTailCatchUp.test.ts     — log tail seek and catch-up
tests/integration/codexLiveToolTimeout.test.ts — tool call timeout propagation
tests/integration/opencodeApi.test.ts          — HTTP client request/response
tests/integration/mockSnapshotServer.test.ts   — snapshot broadcast round-trip
```

---

## Layer 3 — E2E UI Tests (Playwright)

**Scope:** Full browser rendering of the isometric agent dashboard. Tests interact with the live UI via DOM assertions and injected mock state.

**What is covered:**
- Agent activation latency (< 250ms from snapshot injection to DOM update)
- No flicker during rapid idle ↔ active transitions (MutationObserver guard)
- Focus retention when other agents update
- Lane filtering by match query
- Agent panel open/close on selection
- Codex TUI live demo lane rendering
- Video recording of activation sequences (opt-in via `PW_VIDEO=1`)

**Compute cost:** ~$0.50 in GitHub Actions minutes (Playwright installs Chromium ~130MB, tests run headless). Local cost: ~0.

### Setup

```bash
# One-time: install Playwright browsers
npx playwright install
# or with system deps (CI):
npx playwright install --with-deps
```

### Commands

```bash
# All E2E tests (headless)
npm run test:ui

# With video recording (saves to playwright-report/)
PW_VIDEO=1 npm run test:ui

# Run a single spec
npx playwright test e2e/ui.pw.ts

# Watch mode
npm run test:ui:watch

# Show HTML report after a run
npx playwright show-report
```

### Environment

The test server auto-starts via `webServer` in `playwright.config.ts`:

```
ACTIVITY_TEST_MODE=1 CONSENSUS_PORT=8787 CONSENSUS_HOST=127.0.0.1 npm run dev
```

Mock mode is enabled via `?mock=1` query param, which injects `window.__consensusMock` and bypasses the WebSocket connection to the real scanner.

### Pass criteria

| Criterion | Requirement |
|-----------|-------------|
| Exit code | 0 |
| Activation latency | Active agent appears in DOM within 250ms of snapshot injection |
| No flicker | Zero mutations show 0-item or "No active agents." during rapid updates |
| Focus retention | Panel remains open when unrelated agent updates arrive |
| Lane filter | Filtered agents absent from lane, unfiltered agents present |
| Build | `npm run build` exits 0 after all tests pass |

### Fail criteria

Server fails to start on port 8787 (kill existing process), browser binary missing (re-run `npx playwright install`), or any visual regression.

### Key test files

```
e2e/ui.pw.ts                     — focus retention, lane filtering
e2e/activity.pw.ts               — activation latency, flicker guard
e2e/ui/activation.pw.ts          — agent activation/deactivation sequences
e2e/ui/codexTuiLiveDemo.pw.ts    — live Codex TUI lane rendering
e2e/ui/flicker.pw.ts             — MutationObserver flicker detection
```

---

## Layer 4 — Production Dogfood

**Scope:** Run `consensus-cli` against real AI coding agent processes on a developer machine. Validates that the scanner, log parser, and WebSocket stream work end-to-end without mocks.

**What is covered:**
- Process scanner discovers live Codex/Claude/OpenCode PIDs
- Activity state correctly reflects real agent behavior (idle on prompt, active on tool call)
- WebSocket snapshot stream delivers updates within the configured poll window
- No memory leak over a 30-minute continuous session (monitor via `process.memoryUsage()` logs)
- CLI binary (`consensus` / `consensus-cli`) starts, serves dashboard, and exits cleanly

**Compute cost:** ~$0 (runs on developer hardware). Requires at least one active AI coding agent session.

### Setup

```bash
# Build the project first
npm run build

# Smoke test the CLI binary
node dist/cli.js --help

# Or via npx (from published package)
npx consensus-cli@latest
```

### Dogfood procedure

1. Start at least one active agent session (any of: `claude`, `codex`, `opencode`)
2. In a separate terminal, launch `consensus-cli`:
   ```bash
   node dist/cli.js
   # or
   CONSENSUS_POLL_MS=1000 node dist/cli.js
   ```
3. Open `http://localhost:8787` in a browser
4. Verify:
   - Active agent appears in the active lane within 2 poll cycles
   - CPU and memory values update when the agent does work
   - Agent transitions to idle after completing a task
   - Panel opens on agent click, shows PID, cwd, and current activity
5. Run for 30 minutes under normal usage

### Pass criteria

| Criterion | Requirement |
|-----------|-------------|
| Agent discovery | All running Codex/Claude/OpenCode processes appear within 2s |
| Activation lag | Idle → active transition shown within 2 × `CONSENSUS_POLL_MS` |
| Idle transition | Active → idle shown within 10s of agent stopping |
| Error display | Error state shown within 1 poll cycle of an agent crash |
| Memory | RSS does not grow more than 50MB over 30 minutes |
| Clean exit | `Ctrl+C` shuts down server gracefully (no dangling ports) |

### Fail criteria

Any process not appearing in the dashboard, stale state displayed after an agent stops, or RSS growing unboundedly. File a bug with `CONSENSUS_LOG_LEVEL=debug` output attached.

### Performance benchmarks

```bash
# Measure server startup time
time node dist/server.js &
curl -s http://localhost:8787/health && kill %1

# Check WebSocket snapshot latency (requires wscat)
wscat -c ws://localhost:8787 2>&1 | head -20
```

---

## Full gate sequence (CI)

```bash
npm ci
npm run test               # Layer 1 + 2
npx playwright install --with-deps
npm run test:ui            # Layer 3
npm run build              # Verify build artifact
```

This is the exact sequence run in `.github/workflows/ci.yml`.

---

## Coverage gaps (known)

These are currently untested and represent risk before a public release:

| Area | Gap | Severity |
|------|-----|----------|
| `src/scan.ts` (90KB) | No direct unit tests for the process scanner | High |
| `src/server.ts` | WebSocket broadcast logic not covered by integration tests | Medium |
| OpenTelemetry | `src/observability/` not tested at all | Low |
| Multi-machine relay | Future feature, no tests planned yet | N/A |
| Windows | CI only runs on `ubuntu-latest`; no Windows runner | Medium |
| npm publish dry-run | `npm pack --dry-run` not in CI | Low |

---

## Related docs

- [docs/testing.md](testing.md) — command reference
- [docs/test-plan.md](test-plan.md) — GWT behavior specs
- [docs/state-transitions.md](state-transitions.md) — state machine reference
- [e2e/ui/README.md](../e2e/ui/README.md) — Playwright UI test spec
