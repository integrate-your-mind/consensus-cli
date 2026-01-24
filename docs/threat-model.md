# Threat model

## Entry points
- CLI args and environment variables.
- HTTP server endpoints.

## Trust boundaries
- Local machine only by default.
- No external services required.

## Secrets handling
- The app does not require secrets.
- Redaction protects common PII patterns.

## Data in transit
- HTTP over localhost unless explicitly exposed.

## Logging risks
- Avoid logging secrets; use redaction for summaries.
