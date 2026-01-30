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

## Claude shows idle
Claude activity is hook-driven. Configure Claude Code hooks to call
`dist/claudeHook.js` and post to `http://127.0.0.1:<port>/api/claude-event`
from `~/.claude/settings.json`, `.claude/settings.json`, or
`.claude/settings.local.json`.

Minimal config (tool hooks require a matcher):
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node /path/to/consensus-cli/dist/claudeHook.js http://127.0.0.1:8787/api/claude-event" }
        ]
      }
    ]
  }
}
```

Debug tip: run Claude with `--debug` and confirm logs include
`Found <n> hook matchers in settings` and `Executing <event> hooks`
for your events.

Dev tip: if you are running the server via `npm run dev`, point hooks at the
TypeScript entrypoint so changes apply without a build:
`node --import tsx /path/to/consensus-cli/src/claudeHook.ts http://127.0.0.1:<port>/api/claude-event`

## WebSocket disconnects
Check for network proxies, and reload. The client will auto-reconnect.
