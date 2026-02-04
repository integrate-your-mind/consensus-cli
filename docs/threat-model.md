# Threat model

## Entry points
- CLI args and environment variables.
- HTTP server endpoints.

## Trust boundaries
- Local machine only by default.
- Remote bind requires `CONSENSUS_ALLOW_REMOTE=1` and `CONSENSUS_API_TOKEN`.

## Secrets handling
- The app does not require secrets by default.
- Optional `CONSENSUS_API_TOKEN` gates remote access.
- Redaction protects common PII patterns; strict mode expands secret patterns.

## Data in transit
- HTTP over localhost unless explicitly exposed.

## Logging risks
- Avoid logging secrets; use redaction for summaries.
