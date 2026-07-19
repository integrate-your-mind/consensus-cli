# CLI

## Start the local server

```bash
npx consensus-cli
```

The server prints the local browser URL. Use `npx consensus-cli --help` for server flags.

## Configure Codex

```bash
npx consensus-cli setup
```

Setup writes the notify command to the user-level `~/.codex/config.toml`. It does not rely on project-local Codex config, where the current Codex contract does not support `notify`.

## Inspect graphs and loops

```bash
npx consensus-cli graph
npx consensus-cli graph --json
npx consensus-cli graph --snapshot snapshot.json
cat snapshot.json | npx consensus-cli graph --snapshot -
```

Live graph inspection is read-only. It sets OpenCode autostart off before loading the scanner, restores the environment afterward, and never calls `opencode serve` itself.

Snapshot input must contain:

- finite numeric `ts`
- an `agents` array
- valid agent `id`, `pid`, provider `kind`, and state
- structurally valid retained events when `events` is present

Malformed JSON, unknown provider kinds, invalid states, and malformed events fail with a non-zero exit code.

## One-shot snapshot

```bash
npm run scan
```

This wrapper hydrates bounded Claude hook metadata before scanning, so one-shot output can include Claude phase history captured by the local server.
