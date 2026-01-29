import { Effect, Metric, MetricBoundaries } from "effect";
import { observabilityEnabled } from "./otel.js";

const httpRequestsTotal = Metric.counter("http_requests_total", {
  description: "Total HTTP requests",
  incremental: true,
});
const httpRequestDurationMs = Metric.histogram(
  "http_request_duration_ms",
  MetricBoundaries.linear({ start: 0, width: 50, count: 40 }),
  "HTTP request duration in ms"
);

const jobsStartedTotal = Metric.counter("jobs_started_total", {
  description: "Total jobs started",
  incremental: true,
});
const jobsCompletedTotal = Metric.counter("jobs_completed_total", {
  description: "Total jobs completed",
  incremental: true,
});
const jobDurationMs = Metric.histogram(
  "job_duration_ms",
  MetricBoundaries.linear({ start: 0, width: 50, count: 40 }),
  "Job duration in ms"
);
const scanInFlightGauge = Metric.gauge("scan_inflight", {
  description: "Scan in-flight gauge",
});
const scanLastDurationGauge = Metric.gauge("scan_last_duration_ms", {
  description: "Last scan duration in ms",
});
const scanStallTotal = Metric.counter("scan_stall_total", {
  description: "Scan stall detections",
  incremental: true,
});

const errorsTotal = Metric.counter("errors_total", {
  description: "Total errors",
  incremental: true,
});

const activeSessionsGauge = Metric.gauge("active_sessions", {
  description: "Active sessions gauge",
});
const activitySessionsGauge = Metric.gauge("activity_sessions", {
  description: "Session counts by provider and state",
});
const activityTransitionsTotal = Metric.counter("activity_state_transitions_total", {
  description: "Session state transitions",
  incremental: true,
});

function withTags<Type, In, Out>(
  metric: Metric.Metric<Type, In, Out>,
  tags: Record<string, string>
): Metric.Metric<Type, In, Out> {
  let tagged = metric;
  for (const [key, value] of Object.entries(tags)) {
    tagged = Metric.tagged(tagged, key, value);
  }
  return tagged;
}

export function recordHttpMetrics(params: {
  method: string;
  route: string;
  status: string;
  durationMs: number;
}): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const counter = withTags(httpRequestsTotal, {
    method: params.method,
    route: params.route,
    status: params.status,
  });
  const duration = withTags(httpRequestDurationMs, {
    method: params.method,
    route: params.route,
  });
  return Effect.all([
    counter(Effect.succeed(1)),
    duration(Effect.succeed(params.durationMs)),
  ]).pipe(Effect.asVoid);
}

export function recordJobStart(provider: string): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const counter = withTags(jobsStartedTotal, { provider });
  return counter(Effect.succeed(1)).pipe(Effect.asVoid);
}

export function recordJobComplete(
  provider: string,
  status: "ok" | "error",
  durationMs: number
): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const counter = withTags(jobsCompletedTotal, { provider, status });
  const duration = withTags(jobDurationMs, { provider });
  return Effect.all([
    counter(Effect.succeed(1)),
    duration(Effect.succeed(durationMs)),
  ]).pipe(Effect.asVoid);
}

export function recordScanInFlight(active: boolean, mode: string): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const gauge = withTags(scanInFlightGauge, { mode });
  return gauge(Effect.succeed(active ? 1 : 0)).pipe(Effect.asVoid);
}

export function recordScanDuration(durationMs: number, mode: string): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const gauge = withTags(scanLastDurationGauge, { mode });
  return gauge(Effect.succeed(durationMs)).pipe(Effect.asVoid);
}

export function recordScanStall(durationMs: number, mode: string): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const counter = withTags(scanStallTotal, { mode });
  return counter(Effect.succeed(1))
    .pipe(Effect.tap(() => recordScanDuration(durationMs, mode)))
    .pipe(Effect.asVoid);
}

export function recordError(errorType: string): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const counter = withTags(errorsTotal, { error_type: errorType });
  return counter(Effect.succeed(1)).pipe(Effect.asVoid);
}

export function recordActiveSessions(total: number): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  return activeSessionsGauge(Effect.succeed(total)).pipe(Effect.asVoid);
}

export function recordActivityCount(
  provider: string,
  state: string,
  count: number
): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const gauge = withTags(activitySessionsGauge, { provider, state });
  return gauge(Effect.succeed(count)).pipe(Effect.asVoid);
}

export function recordActivityTransition(
  provider: string,
  from: string,
  to: string,
  reason: string
): Effect.Effect<void> {
  if (!observabilityEnabled) return Effect.void;
  const counter = withTags(activityTransitionsTotal, { provider, from, to, reason });
  return counter(Effect.succeed(1)).pipe(Effect.asVoid);
}
