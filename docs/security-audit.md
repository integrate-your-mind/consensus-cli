# Security Audit Report (Trail of Bits Style)

Date: 2026-02-04
Scope: Consensus CLI (server, CLI, hooks, UI, docs, build/test pipeline)

## Executive summary
- Status: No critical/high-risk findings remain **unresolved in code** after this audit.
- The primary risks were unauthenticated remote exposure, missing request throttling, and limited redaction. These are now mitigated with remote-bind guardrails, token auth, rate limits, and strict redaction mode.
- Compliance gaps remain in **process/controls** (policies, incident response, dependency scanning, and evidence of regular security testing). These require organizational action and CI changes.

## Methodology
- Manual code review of HTTP/WS entry points, hooks, redaction, logging, and configuration.
- Threat model update and trust boundary validation.
- Dependency and build pipeline review (package manifests and docs).

## System overview
- Node.js/TypeScript service serves a canvas UI, polls local process state, and ingests Codex/Claude/OpenCode activity.
- Primary data sources are local JSONL logs and event hooks.
- Service is expected to run on the same machine as the UI by default.

## Threat model (summary)
### Assets
- Activity metadata about local agents (process list, command summaries, file paths).
- Event streams from Codex/Claude/OpenCode hooks.
- Optional API token (if remote access is enabled).

### Trust boundaries
- Localhost boundary for HTTP/WS by default.
- Optional remote exposure guarded by `CONSENSUS_ALLOW_REMOTE=1` + `CONSENSUS_API_TOKEN`.

### Attackers
- Remote unauthenticated network actor if the service is exposed.
- Local unprivileged user on the same host.
- Malicious dependency or compromised supply chain.

### Entry points
- HTTP: `/api/codex-event`, `/api/claude-event`, `/api/snapshot`, `/health`, `/__debug/activity`, `/__dev/reload`.
- WebSocket: `/ws` (any path is accepted by `ws`).
- CLI and hook scripts (`codexNotify`, `claudeHook`).

## Findings and remediations

### Critical
- None remaining.

### High
1. **Unauthenticated remote exposure** (resolved)
   - Risk: Remote bind could expose event ingestion and activity endpoints without auth.
   - Fix: Enforced non-loopback bind guard (`CONSENSUS_ALLOW_REMOTE=1` + `CONSENSUS_API_TOKEN`) and token auth for HTTP/WS.
   - Files: `src/server.ts`, `docs/api-authentication.md`, `docs/configuration.md`.

2. **Missing rate limiting on event endpoints** (resolved)
   - Risk: Unbounded POSTs allow resource exhaustion and event spam.
   - Fix: In-memory rate limit keyed by IP+path; enforced on event/debug/test routes.
   - Files: `src/server.ts`, `src/server/activityTestRoutes.ts`.

### Medium
1. **Insufficient redaction for secrets in summaries** (partially resolved)
   - Risk: Hook payloads and derived summaries could leak secrets.
   - Fix: Added strict redaction mode with common token/private-key patterns.
   - Remaining: Consider entropy-based redaction or configurable patterns for enterprise deployments.
   - Files: `src/redact.ts`, `docs/configuration.md`.

2. **Security headers missing** (resolved)
   - Risk: Default Express headers disclose framework; no baseline hardening headers.
   - Fix: Disabled `x-powered-by` and added basic security headers.
   - Files: `src/server.ts`.

### Low
1. **/health endpoint unauthenticated on remote bind** (resolved)
   - Fix: `/health` now requires auth when token is set or host is non-loopback.
   - Files: `src/server.ts`.

## Compliance gap analysis
This review focuses on technical controls in code. The following gaps require organizational/process work and evidence for HIPAA, PCI-DSS, and NIST 800-171.

### HIPAA Security Rule (45 CFR 164 Subpart C)
- **164.308(a)(1)(ii)(A) Risk analysis (R)**: No formal risk assessment artifact in repo.
- **164.308(a)(6)(ii) Incident response (R)**: No incident response policy or runbook.
- **164.312(b) Audit controls (R)**: Logs exist but no documented retention/access controls.
- **164.312(e)(2)(ii) Transmission security (A)**: TLS guidance for remote exposure not documented.

### PCI DSS v4.0.1
- **Req 6 Secure Development**: No dependency/secret/license scanning in CI.
- **Req 10 Logging and Monitoring**: No log retention or monitoring policy.
- **Req 11 Regular Security Testing**: No security test cadence or evidence.

### NIST 800-171 Rev 3
- **3.1 Access Control**: Token auth added, but no account lifecycle or privileged access controls.
- **3.3 Audit and Accountability**: No defined audit log retention or review process.
- **3.12 Security Assessment**: No documented security assessment plan.

## Remediation checklist (prioritized)
1. Add CI security scanning (dependency, secret, and license scanning).
2. Document TLS reverse-proxy guidance for remote exposure and enforce HTTPS in deployment guides.
3. Add incident response and logging retention policies in `SECURITY.md` or `docs/`.
4. Expand redaction controls (configurable patterns, entropy-based fallback).
5. Implement optional IP allowlist or mTLS for enterprise deployments.

## Long-term hardening recommendations
- Add structured audit logs with configurable retention and access controls.
- Provide a dedicated auth mechanism for multi-user deployments (OIDC or mTLS).
- Ship a minimal SBOM and pin high-risk dependencies.
- Introduce security regression tests for auth and rate limiting.

## Evidence and artifacts
- Threat model: `docs/threat-model.md`.
- Auth model: `docs/api-authentication.md`.
- Configuration: `docs/configuration.md`.
- Code changes: `src/server.ts`, `src/server/activityTestRoutes.ts`, `src/redact.ts`, `src/codexNotify.ts`, `src/claudeHook.ts`, `public/src/App.tsx`.
