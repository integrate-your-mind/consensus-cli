import { Effect } from "effect";
import { observabilityEnabled } from "./otel.js";

export type SpanAttributes = Record<string, string | number | boolean>;

export function withSpan<A, E, R>(
  name: string,
  options?: { attributes?: SpanAttributes }
): (effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  if (!observabilityEnabled) {
    return (effect) => effect;
  }
  return Effect.withSpan(name, options);
}

export function annotateSpan(
  key: string,
  value: string | number | boolean
): Effect.Effect<void> {
  if (!observabilityEnabled) {
    return Effect.void;
  }
  return Effect.annotateCurrentSpan(key, value).pipe(Effect.asVoid);
}
