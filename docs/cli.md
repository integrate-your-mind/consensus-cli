# CLI

## Start the local server

```bash
npx consensus-cli
```

The server prints the local browser URL. Use `npx consensus-cli --help` for server flags.

## Configure hooks

```bash
npx consensus-cli setup
```

This configures the recommended Codex notify hook.

## Inspect graphs and loops

Build a provider-neutral execution graph from live local sessions:

```bash
npx consensus-cli graph
```

Print the full versioned graph payload:

```bash
npx consensus-cli graph --json
```

Analyze a saved Consensus snapshot:

```bash
npx consensus-cli graph --snapshot snapshot.json
```

Read a snapshot from stdin:

```bash
cat snapshot.json | npx consensus-cli graph --snapshot -
```

The graph command is read-only. It detects observed phase cycles but does not start, stop, retry, or route agent work.

See `docs/graphs-and-loops.md` for the graph model and current limits.
