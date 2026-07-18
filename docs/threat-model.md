# Threat model

## Entry points

- CLI arguments and snapshot files.
- Environment variables.
- Local HTTP and WebSocket endpoints.
- Codex notify payloads.
- OpenCode HTTP/SSE responses.
- Claude hook payloads.

## Trust boundaries

- Consensus binds to localhost by default.
- Provider logs, events, and user-supplied snapshots are untrusted input.
- The project does not require API secrets.
- Exposing the server beyond localhost creates a new trust boundary and is not the default deployment model.

## Main risks and controls

### Path and identity disclosure

Risk: provider identities can contain home directories or raw session paths.

Controls:

- Graph keys use truncated SHA-256 identifiers derived from provider plus local identity.
- Raw identities are not emitted in graph node or loop relationship fields.
- Claude persisted metadata uses an opaque working-directory key rather than the path.

### Content retention

Risk: hook payloads can contain prompts, assistant text, tool input/output, transcript paths, tasks, and error details.

Controls:

- The Claude hook adapter selects only small metadata fields before posting to Consensus.
- `MessageDisplay.delta`, tool input/output, prompt content, task descriptions, and error details are not retained.
- The local metadata log is bounded and can be disabled.

### Local file access

Risk: another local user reads retained metadata.

Controls:

- Claude metadata directory is created with mode `0700`.
- Metadata file is set to mode `0600` after writes and rotation.
- No network upload path exists.

### Graph false positives

Risk: lifecycle records or separate turns form a false cycle.

Controls:

- Lifecycle and transport events are excluded from graph phases.
- Every prompt opens a new segment.
- Transition edges never cross segment boundaries.
- Only the latest step receives live state.

### Side effects from inspection

Risk: a read-only graph command starts an OpenCode server.

Control: `consensus graph` sets `CONSENSUS_OPENCODE_AUTOSTART=0` before dynamically loading the scanner, then restores the prior environment value.

### Malformed snapshots

Risk: invalid JSON or fields crash graph inspection or misclassify providers.

Control: the graph CLI validates timestamps, agents, provider kinds, states, and retained events before building a graph.

## Logging

- Avoid logging secrets or content-bearing provider payloads.
- Use existing redaction for user-facing summaries.
- Do not treat URL encoding as anonymization.
