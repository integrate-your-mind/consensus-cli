import { Effect, ManagedRuntime } from "effect";
import { observabilityConfig, observabilityLayer } from "./otel.js";

const runtime = ManagedRuntime.make(observabilityLayer);

function withTelemetry<A, E>(
  effect: Effect.Effect<A, E, never>
): Effect.Effect<A, E, never> {
  if (!observabilityConfig.enabled) return effect;
  return Effect.tagMetrics("environment", observabilityConfig.environment)(effect);
}

export function runPromise<A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> {
  return runtime.runPromise(withTelemetry(effect));
}

export function runFork<A, E>(effect: Effect.Effect<A, E, never>) {
  return runtime.runFork(withTelemetry(effect));
}

export function disposeObservability(): Promise<void> {
  return runtime.dispose();
}
