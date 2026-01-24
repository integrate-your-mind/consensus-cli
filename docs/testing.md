# Testing

## Unit + integration tests
```bash
npm run test
```

## Watch mode
```bash
npm run test:watch
```

### Unit only
```bash
npm run test:unit
```

### Integration only
```bash
npm run test:integration
```

## UI automation
This project uses Playwright for UI tests.

### Install browsers
```bash
npx playwright install
```

### Run UI tests
```bash
npm run test:ui
```

### Mock mode
UI tests use `?mock=1` to bypass WebSocket and inject snapshots.
The browser exposes `window.__consensusMock` with:
- `setSnapshot(snapshot)`
- `setAgents(agents)`

## CLI smoke test
```bash
npx consensus-cli --help
```
