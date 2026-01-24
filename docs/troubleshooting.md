# Troubleshooting

## I get a 404 at the root
Another service may be bound to the same port. Set a different port:
```bash
CONSENSUS_PORT=8790 npm run dev
```

## The UI loads but shows no agents
- Ensure Codex is running.
- Confirm the process matcher: `CONSENSUS_PROCESS_MATCH`.

## "Doing" is empty
The session JSONL could not be resolved or is still empty. This is expected for
new sessions or when logs are missing.

## WebSocket disconnects
Check for network proxies, and reload. The client will auto-reconnect.
