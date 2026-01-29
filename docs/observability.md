# Observability (dev)

This repo uses Effect + OpenTelemetry. Telemetry is opt-in and disabled by default.

## Quickstart (Jaeger)

1) Start Jaeger all-in-one (collector + UI):
```bash
docker run --rm -p 16686:16686 -p 4317:4317 -p 4318:4318 jaegertracing/all-in-one:latest
```

2) Run the dev server with OTEL enabled:
```bash
CONSENSUS_OTEL_ENABLED=1 CONSENSUS_OTEL_ENDPOINT=http://localhost:4318 npm run dev
```

3) Generate traffic:
```bash
curl -s http://127.0.0.1:8787/health > /dev/null
curl -s http://127.0.0.1:8787/api/snapshot > /dev/null
```

4) Open Jaeger UI:
- http://localhost:16686
- Select service: `consensus-cli`
- Click **Find Traces**

## Notes
- Jaeger shows traces. Metrics require a metrics backend (e.g., Prometheus + Grafana).
- If `CONSENSUS_OTEL_ENDPOINT` is unset, console exporters are used by default.
