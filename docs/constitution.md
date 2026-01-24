# App Builder Constitution

A reusable best-practices document for OSS projects and YC-style startup work.

Not legal advice. Use this as a build and ops guide. Ask a lawyer for license, IP, privacy, and tax issues.

## Preamble

This Constitution defines how we build, ship, and run software that:
- solves a clear user problem,
- earns user trust,
- stays easy to change,
- grows through simple adoption,
- and can run as a healthy open source project.

This document applies to every repo, app, service, library, and tool we ship.

## Definitions

Use these words with the meanings below:
- User: the person who uses the product.
- Customer: the person or org that pays.
- Project: a repo that ships code.
- Release: a tagged version with notes.
- Public API: anything we export, document, or promise.
- Breaking change: anything that makes old use fail.
- Secure by default: a new install does not expose data or admin access.
- Time to value: time from install to the first useful result.
- Wedge: the first job we do very well for a narrow user group.

Normative words:
- MUST / SHALL: required.
- SHOULD: strong default; allow exceptions with written reason.
- MAY: optional.

## Article I -- Purpose, Scope, and Focus

### I.1 Purpose
1. The project SHALL state a single primary use case.
2. The project SHALL state at least one thing it will not do.
3. The project SHALL keep scope small until users pull it wider.

### I.1.a Scope guardrails
- We SHALL reject features that:
  - do not reduce user pain,
  - do not increase adoption,
  - or add large cost without clear gain.
- We SHALL prefer one job done well over many jobs done poorly.

### I.1.b Decision record
- For any non-trivial choice (deps, storage, license, auth, pricing), we SHALL write a short decision note in `docs/decisions/`.
- Each note SHALL include:
  - the problem,
  - options we considered,
  - what we chose,
  - tradeoffs,
  - and how to revisit later.

### I.2 Audience
1. We SHALL define:
  - primary user,
  - primary customer,
  - top 3 user goals,
  - and top 3 user fears (data loss, lock-in, cost, etc).
2. We SHALL keep these in `docs/audience.md`.

### I.3 Product promises
1. We SHALL publish a short "Product promises" list:
  - what we guarantee,
  - what we do not guarantee,
  - and what is "best effort."

## Article II -- Problem, Wedge, and Proof

### II.1 Problem statement
1. We SHALL write the problem in plain words, with no filler.
2. We SHALL include:
  - who has the problem,
  - when they feel it,
  - what they do now,
  - what it costs them (time, money, risk),
  - and why old tools fail.

### II.1.a Test for clarity
- If a new reader cannot restate the problem in one sentence after 30 seconds, we SHALL rewrite.

### II.2 Wedge selection
1. The first release SHALL target a narrow wedge.
2. The wedge SHALL:
  - reduce time to value,
  - avoid heavy setup,
  - and avoid org-wide buy-in.

### II.2.a Wedge checklist
A wedge SHOULD:
- work for an individual dev or small team,
- require no sales call,
- work on a laptop,
- and scale later.

### II.3 Proof loop
1. We SHALL define a proof loop:
  - how we learn if the product works,
  - how we measure it,
  - and how fast we ship fixes.

### II.3.a Proof metrics
Pick 3-7 metrics per project. Examples:
- activation rate (users who finish quickstart),
- time to first success,
- weekly active users,
- retention after 7/30 days,
- query latency (if search),
- error rate,
- and support ticket volume.

### II.3.b Public proof (OSS)
If open source:
- We SHOULD track:
  - unique installs,
  - repeat installs,
  - GitHub stars (weak signal),
  - issues opened vs closed,
  - PRs merged,
  - number of repeat contributors,
  - and release cadence.

## Article III -- Repo Structure and Required Files

### III.1 Root files (required)
Each repo SHALL include these files at root:
- README.md
- LICENSE
- SECURITY.md
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- CHANGELOG.md (or auto-generated release notes with a link)
- .gitignore
- .editorconfig

### III.1.a Strongly recommended root files
- GOVERNANCE.md
- ROADMAP.md
- SUPPORT.md
- ARCHITECTURE.md
- docs/ folder with:
  - install,
  - config,
  - examples,
  - decisions,
  - troubleshooting.

### III.2 Monorepo rules
If we use a monorepo:
1. We SHALL keep package boundaries real.
2. We SHALL not depend on a package without listing it in package.json.
3. We SHALL keep build graphs simple.

### III.2.a Workspace hygiene
- Pin tool versions:
  - Node version file (.nvmrc or .tool-versions)
  - package manager version
- Commit lockfiles.
- Document top commands in README.
- Keep each package's scripts consistent:
  - build, test, lint, typecheck, dev.

### III.2.b Import/export rules
- Re-exports SHALL not hide needed imports.
- A module SHALL import what it uses.
- A package SHALL not rely on "it works due to build order."

## Article IV -- README and Docs That Convert

### IV.1 README structure (required)
The README SHALL include, in this order:
1. One sentence: what it does.
2. Who it is for.
3. Quickstart: copy/paste.
4. One real example with expected output.
5. Core features list.
6. How it works (short).
7. Install options (local, Docker, hosted).
8. Config (link to config doc).
9. Security note (link to SECURITY.md).
10. Contributing note (link).
11. License note.

### IV.1.a README quality rules
- Every command SHALL be runnable as written.
- Every example SHALL show expected output.
- We SHALL avoid vague claims ("fast", "easy") without numbers or proof.

### IV.2 Docs rules
1. Docs SHALL match the released code.
2. Docs SHALL explain defaults.
3. Docs SHALL include failure modes and fixes.

### IV.2.a Doc set (minimum)
- Install
- Quickstart
- Config reference
- CLI reference (or link to --help)
- API reference (if library)
- Troubleshooting
- Architecture overview

### IV.2.b Doc set (strong)
- "How to extend" guide (plugins, sources, adapters)
- "How to deploy" guide (prod)
- "How to upgrade" guide (breaking changes)
- "How to secure" guide (hardening checklist)

### IV.2.c Doc testing
- We SHOULD run doc snippets in CI.
- We SHALL keep at least one end-to-end example in CI.

## Article V -- Code Design, Style, and Change Safety

### V.1 Design principles
1. We SHALL prefer simple code over clever code.
2. We SHALL keep state explicit.
3. We SHALL isolate side effects.
4. We SHALL separate:
  - input parsing,
  - core logic,
  - and output rendering.

### V.1.a Boundaries
- Each boundary SHALL validate inputs.
- Each boundary SHALL return errors with:
  - what happened,
  - where,
  - and how to fix.

### V.2 Public API discipline
1. Anything documented becomes a contract.
2. We SHALL not break contracts without a major release.
3. We SHALL deprecate before removal.

### V.2.a Deprecation rules
- A deprecation SHALL include:
  - the old way,
  - the new way,
  - and a timeline.
- We SHOULD keep deprecated behavior for one minor line if possible.

### V.3 Coding standards
1. We SHALL enforce formatting and linting.
2. We SHALL enforce type checks.
3. We SHALL block merges when checks fail.

### V.3.a Style rules (sub-rules)
- Name things by what they do.
- Avoid "manager", "util", "helper" names unless needed.
- Keep functions small:
  - one job,
  - few args,
  - clear return types.
- Keep files small:
  - split when a file becomes hard to scan.

### V.3.b Comments
- Comments SHALL explain "why", not "what".
- Comments SHALL stay updated or be removed.

### V.3.c Error handling
- Errors SHALL carry context:
  - operation,
  - resource id,
  - and key params (never secrets).
- Errors SHOULD include an error code string for grouping.

## Article VI -- Testing Constitution

### VI.1 Test layers
We SHALL have tests at these layers, as needed:
1. Unit tests: core logic.
2. Integration tests: module interactions (db, file, network stubs).
3. End-to-end tests: user workflows (CLI/server).

### VI.1.a Coverage expectations
- We SHALL cover:
  - core logic,
  - public API,
  - and critical bugs we fix (regression tests).
- We SHOULD cover:
  - error paths,
  - config parsing,
  - and upgrade paths.

### VI.2 Test quality rules
- Tests SHALL be:
  - repeatable,
  - fast,
  - and clear.
- Tests SHALL not:
  - rely on real network,
  - rely on real time without control,
  - or require manual setup.

### VI.2.a Determinism rules
- Freeze time in tests when time matters.
- Seed random values when random matters.
- Use temp dirs; do not write to user home.

### VI.3 Test data rules
- Test fixtures SHALL be small.
- Fixtures SHALL not include private or licensed data.
- If we need large data, we SHALL generate it in tests.

## Article VII -- CI/CD and Build Discipline

### VII.1 Required CI checks
Each repo SHALL run these on every PR:
- install
- lint
- typecheck
- unit tests
- build

### VII.1.a Strong CI checks
- integration tests
- e2e smoke tests
- example builds
- docs snippet tests
- packaging dry run (publish simulation)

### VII.2 Branch rules
- Protect main.
- Require PRs.
- Require green checks.
- Require review.

### VII.2.a Review rules
- Reviewers SHALL check:
  - correctness,
  - tests,
  - docs,
  - and security impact.
- Reviewers SHALL request changes when risk rises without tests.

### VII.3 Build rules
- Builds SHALL be reproducible.
- Build steps SHALL not rely on hidden machine state.
- Tool versions SHALL be pinned.

## Article VIII -- Release, Versions, and Upgrade Path

### VIII.1 Version scheme
We SHALL use version numbers like MAJOR.MINOR.PATCH.
- PATCH: bug fixes, no contract changes.
- MINOR: new features, no breaking changes.
- MAJOR: breaking changes.

### VIII.1.a Pre-release rules
- Use -alpha, -beta, -rc tags if needed.
- Mark unstable APIs clearly.

### VIII.2 Release notes
Each release SHALL include:
- what changed,
- who it affects,
- how to upgrade,
- and any risks.

### VIII.2.a Changelog rules
- Every user-visible change SHALL appear in notes.
- Notes SHALL include links to PRs/issues.

### VIII.3 Backward compatibility
- We SHALL keep old configs working when possible.
- If not possible, we SHALL provide a migration guide and a tool/script if feasible.

## Article IX -- Security Constitution

### IX.1 Secure defaults
A default install SHALL:
- bind to localhost unless the user opts in,
- require auth for remote access,
- avoid world-readable files,
- and avoid open admin endpoints.

### IX.2 Threat model (minimum)
For each project, we SHALL document:
- what data we store,
- where it flows,
- who can access it,
- and what we defend against.

### IX.2.a Threat model sections
- Entry points (CLI args, HTTP endpoints, files)
- Trust boundaries (user machine vs server vs third-party)
- Secrets handling
- Data at rest
- Data in transit
- Logging risks
- Plugin risks

### IX.3 Vulnerability reporting
SECURITY.md SHALL include:
- private contact method,
- what info to include,
- expected response steps (not timelines),
- and how we publish fixes.

### IX.4 Dependency risk
- We SHALL scan for known bad versions.
- We SHOULD keep a list of "high risk deps" (parsers, auth, crypto, network).

### IX.5 Input validation
At every boundary:
- Validate type
- Validate size
- Validate format
- Reject unknown fields when safety matters

### IX.5.a File handling
- Limit file size.
- Use safe paths (no path traversal).
- Never trust file names.

### IX.5.b Web handling
- Limit request body sizes.
- Rate limit public endpoints.
- Use CSRF defenses where needed.
- Set safe headers.

### IX.6 Secrets
- Do not log secrets.
- Do not store secrets in git.
- Use env vars or secret stores.
- Rotate keys when exposed.

### IX.6.a Secret scanning
- We SHOULD run a secret scan in CI.
- We SHALL document key rotation steps.

### IX.7 Auth and access control
If the project has users/roles:
- Define roles clearly.
- Default to least access.
- Deny by default.
- Log auth events (no secrets).

## Article X -- Privacy and Data Handling

### X.1 Data inventory
We SHALL maintain a data inventory doc:
- what we collect,
- why we collect it,
- where we store it,
- how long we keep it,
- and how to delete it.

### X.2 Telemetry rules
If we ship telemetry:
- It SHALL be opt-in by default for OSS.
- It SHALL be easy to disable.
- It SHALL never include secrets.
- We SHALL disclose it in README and docs.

### X.3 Data deletion
- We SHALL support delete for user data we store.
- We SHALL document the delete process.

### X.4 Compliance posture
- We SHALL not claim compliance we do not have.
- We MAY describe controls we use (encryption, access logs) without marketing claims.

## Article XI -- Supply Chain and Build Integrity

### XI.1 Dependency policy
- Add a dependency only when:
  - it saves large time,
  - it reduces risk,
  - or it provides a needed feature we cannot build soon.
- For each new dependency, record:
  - why,
  - alternatives,
  - size and risk,
  - license.

### XI.2 Locking and pinning
- Commit lockfiles.
- Pin runtime versions.
- Avoid wide version ranges for high-risk deps.

### XI.3 Build artifacts
- If we publish binaries/images, we SHOULD publish:
  - checksums,
  - and a software parts list (SBOM).

### XI.4 Repro builds
- We SHOULD be able to rebuild the same artifact from the same tag.

## Article XII -- Performance and Reliability

### XII.1 Performance budgets
- Set budgets for:
  - startup time,
  - memory use,
  - and latency for key actions.

### XII.2 Benchmarks
- Keep a small benchmark suite for hot paths.
- Run it on release builds (or on demand).

### XII.3 Reliability practices
- Prefer retries only where safe.
- Use timeouts for network calls.
- Use circuit breaks where a downstream fails often.
- Keep a "safe mode" if startup fails (read-only, minimal features).

## Article XIII -- Product UX, Error UX, and Support

### XIII.1 UX basics
- A new user SHALL succeed with copy/paste steps.
- The app SHALL fail with clear messages.
- The app SHALL suggest fixes.

### XIII.2 Error message rules
Every error shown to a user SHOULD include:
- what failed,
- what the user can do next,
- and where to read more.

### XIII.3 Logging rules
- Support log levels: error/warn/info/debug.
- Make logs easy to search.
- Provide a single debug flag.

### XIII.4 Support channels
- Define where users ask questions.
- Use:
  - issues for bugs and planned work,
  - discussions/chat for how-to.

## Article XIV -- OSS Community and Collaboration

### XIV.1 Open development
- Plan in public.
- Track work in issues.
- Keep discussions readable.

### XIV.2 Contribution experience
CONTRIBUTING.md SHALL include:
- setup steps,
- dev workflow,
- how to run tests,
- how to add a feature,
- and how to submit a PR.

### XIV.2.a Good first issue standard
A good first issue SHALL include:
- exact file paths,
- expected behavior,
- how to test,
- and acceptance checks.

### XIV.3 Code of conduct
- Include it.
- Enforce it.
- Keep moderation steps private where needed.

### XIV.4 Maintainers
- Define how someone becomes a maintainer.
- Define maintainer powers.
- Keep a maintainer list.

## Article XV -- Governance and Decision Making

### XV.1 Governance doc
GOVERNANCE.md SHOULD define:
- who has final say,
- how votes work (if any),
- how conflicts resolve,
- and how to transfer ownership.

### XV.2 Decision process
- Prefer written proposals for large changes.
- Keep proposals short.
- Time-box decisions when risk is low.

### XV.3 Roadmap discipline
- Keep roadmap small.
- State what is next vs later vs maybe.
- Review monthly.

## Article XVI -- Distribution, Growth, and YC-style Signals

### XVI.1 Distribution plan
Every project SHALL state:
- how users will find it,
- why they will try it,
- and why they will keep it.

### XVI.1.a Common channels (pick 1-3)
- developer communities,
- GitHub search,
- docs SEO,
- templates/starter kits,
- integrations,
- a simple demo video,
- or a hosted trial.

### XVI.2 Adoption friction rules
We SHALL reduce friction by:
- requiring no account for local use,
- using one command to run a demo,
- keeping config optional,
- and making uninstall easy.

### XVI.3 Retention hooks
Retention SHOULD come from:
- saved time,
- saved money,
- reduced risk,
- and data/value that grows over time.

Avoid retention that depends on:
- dark patterns,
- forced lock-in,
- or hidden complexity.

### XVI.4 Investor/YC-style proof package (no guarantees)
We SHOULD keep a "proof pack" in `docs/proof/`:
- problem statement
- wedge
- who uses it now
- key metrics (small set)
- 3-10 user quotes (with consent)
- roadmap
- business model plan
- competitive notes (short, factual)

### XVI.4.a What tends to read well
- clear wedge,
- fast time to value,
- active users,
- fast iteration,
- and a simple plan to charge later.

## Article XVII -- Business Model, Pricing, and Trust

### XVII.1 Pricing honesty
- State what is free and what costs money.
- Avoid hidden limits without clear docs.

### XVII.2 OSS + paid plan split (if used)
If we offer a paid plan:
- The OSS core SHALL remain useful.
- Paid features SHOULD be:
  - hosted ops,
  - team features,
  - admin controls,
  - compliance tools,
  - or scale features.

### XVII.3 Avoid bait-and-switch
- Do not remove key OSS features without strong reason.
- If we change license, we SHALL explain clearly and early.

## Article XVIII -- Legal, IP, and License Hygiene

### XVIII.1 License choice
- Choose a license on day one.
- Put it in LICENSE.
- Add SPDX headers if needed.

### XVIII.1.a License decision notes
Record:
- why this license,
- what it means for users,
- and what it means for contributors.

### XVIII.2 Third-party code
- Track third-party notices.
- Keep license compliance scripts if needed.

### XVIII.3 Trademark and name
- Decide what we protect:
  - name,
  - logo,
  - and domain.
- State allowed use in docs.

## Article XIX -- Operational Readiness (for servers, hosted, or serious local tools)

### XIX.1 Runbook
If the project runs as a service, we SHALL have a runbook:
- how to deploy,
- how to roll back,
- how to view logs,
- how to restore data,
- and how to handle incidents.

### XIX.2 Backups
- Define backup plan.
- Test restores.
- Document restore steps.

### XIX.3 Monitoring
- Track:
  - uptime,
  - error rate,
  - latency,
  - and resource use.
- Alert only on things a human can act on.

### XIX.4 Incident process
- Define severity levels.
- Define who responds.
- Write a post-incident note:
  - what happened,
  - why,
  - how we fix,
  - how we prevent.

## Article XX -- The Agent Operating Charter

### XX.1 Hard rules
1. The agent SHALL not push to main.
2. The agent SHALL not merge its own PRs.
3. The agent SHALL not change public APIs without:
  - tests,
  - docs,
  - and release notes.
4. The agent SHALL not add dependencies without:
  - a written reason,
  - alternatives considered,
  - and license check.
5. The agent SHALL not introduce network calls in tests.
6. The agent SHALL not log secrets.

### XX.2 Required workflow for any change
For every task, the agent SHALL:
1. Identify the user-visible behavior.
2. Identify failure modes.
3. Add or update tests.
4. Update docs and examples when behavior changes.
5. Run: lint, typecheck, tests, build.
6. Produce a clear PR summary:
  - what changed,
  - why,
  - how tested,
  - risk and rollback.

### XX.3 Code review checklist the agent MUST satisfy
- Correctness:
  - handles edge cases,
  - handles bad input,
  - returns useful errors.
- Safety:
  - no secret leaks,
  - safe defaults,
  - rate limits if exposed.
- Quality:
  - small changes,
  - clear names,
  - consistent style.
- Docs:
  - README/examples updated.
- Tests:
  - unit + integration where needed,
  - regression test for fixed bugs.

### XX.4 When the agent touches APIs
- If it adds a request field:
  - validate it,
  - document it,
  - add tests for missing/invalid cases.
- If it changes response shape:
  - treat it as breaking unless proven safe.
- If it adds options:
  - keep defaults stable.

### XX.5 When the agent touches ingestion/index/search systems
- Define stable interfaces:
  - SourceIngestResult
  - IndexResult
  - SearchResult
- Keep the pipeline explicit:
  - ingest step outputs typed records
  - index step consumes typed records
  - search step uses indexed data only
- Add at least one e2e test:
  - ingest -> index -> query
- Add "small data" fixtures and keep them in repo.

## Appendix A -- Templates

### A.1 PR template

```
## What
-

## Why
-

## How tested
- [ ] unit tests:
- [ ] integration tests:
- [ ] manual:

## User impact
-

## Docs
- [ ] updated docs
- [ ] updated README/examples

## Risk
-

## Rollback
-
```

### A.2 Bug report template

```
## What happened
## What I expected
## Steps to reproduce
## Logs / output
## Version
## OS / environment
```

### A.3 Feature request template

```
## Problem
## Who has it
## What they do now
## Why it fails
## Proposed change (optional)
## Alternatives
## Success check
```

### A.4 SECURITY.md skeleton

```
# Security Policy

## Reporting a Vulnerability
Please report security issues privately via:
- email: <security@your-domain>
- or GitHub Security Advisories (preferred)

Include:
- affected version
- steps to reproduce
- impact
- any proof of concept

## What to Expect
We will:
- confirm receipt
- assess impact
- ship a fix
- publish notes when safe
```

## Appendix B -- The One-page project spec

```
## Name
## One sentence
## User
## Problem
## Wedge
## Time to value target
## What we will not do
## Key metrics (3-7)
## Risks (top 5)
## Release plan (first 3 milestones)
```

## Appendix C -- The Done definition

A task is "done" only when:
- code works,
- tests pass,
- docs match behavior,
- defaults stay safe,
- and release notes exist for user-visible changes.
