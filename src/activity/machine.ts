/**
 * Activity state machine using Effect
 * Provides declarative, priority-ordered state transitions
 */

import { Effect, Option } from "effect"
import type { ActivityContext, State, StateResult } from "./types.js"

// ============================================================================
// Utility Functions
// ============================================================================

/** Check if a timestamp is within a window from now */
const isWithinWindow = (
  timestamp: number | undefined,
  now: number,
  windowMs: number
): boolean => {
  if (timestamp === undefined) return false
  if (!Number.isFinite(windowMs)) return false
  if (windowMs < 0) return true
  if (windowMs === 0) return false
  return now - timestamp <= windowMs
}

/** Check if hold period has expired */
const isHoldExpired = (
  previousActiveAt: number | undefined,
  now: number,
  holdMs: number
): boolean => {
  if (previousActiveAt === undefined || holdMs <= 0) return true
  return now - previousActiveAt > holdMs
}

/** Calculate spike threshold */
const getSpikeThreshold = (ctx: ActivityContext): number => {
  const base = ctx.cpuThreshold * ctx.spikeMultiplier
  return Math.max(base, ctx.spikeMinimum)
}

// ============================================================================
// State Predicates
// ============================================================================

const hasError = (ctx: ActivityContext): boolean => ctx.hasError

const hasRecentActivity = (ctx: ActivityContext): boolean =>
  isWithinWindow(ctx.lastActivityAt, ctx.now, ctx.eventWindowMs)

const hasInFlightSignal = (ctx: ActivityContext): boolean => {
  if (!ctx.inFlight) return false
  if (ctx.inFlightIdleMs === undefined) return true
  return isWithinWindow(ctx.lastInFlightSignalAt, ctx.now, ctx.inFlightIdleMs)
}

const hasCpuSpike = (ctx: ActivityContext): boolean => {
  const threshold = getSpikeThreshold(ctx)
  return ctx.cpu >= threshold
}

const hasSustainedCpu = (ctx: ActivityContext): boolean =>
  ctx.cpuActiveMs >= ctx.sustainMs && ctx.cpu >= ctx.cpuThreshold

const hasInFlightGrace = (ctx: ActivityContext): boolean =>
  isWithinWindow(ctx.lastInFlightSignalAt, ctx.now, ctx.inFlightGraceMs)

// ============================================================================
// Effect-Based State Derivation
// ============================================================================

/**
 * Determine state using pattern matching and effect composition
 * This replaces nested conditionals with a clear priority order
 */
export const deriveState = (ctx: ActivityContext): Effect.Effect<StateResult> =>
  Effect.gen(function* () {
    // Priority 1: Error state (highest)
    if (hasError(ctx)) {
      return {
        state: "error" as State,
        reason: "error",
        lastActiveAt: ctx.now,
      }
    }

    // Priority 2: Strict in-flight mode
    if (ctx.strictInFlight) {
      if (hasInFlightSignal(ctx)) {
        return {
          state: "active" as State,
          reason: "in_flight",
          lastActiveAt: ctx.now,
        }
      }
      
      if (hasInFlightGrace(ctx)) {
        return {
          state: "active" as State,
          reason: "in_flight_grace",
          lastActiveAt: ctx.now,
        }
      }
      
      return {
        state: "idle" as State,
        reason: "no_in_flight",
      }
    }

    // Priority 3: Active signals (in-flight, CPU spike, recent activity)
    if (hasInFlightSignal(ctx)) {
      return {
        state: "active" as State,
        reason: "in_flight",
        lastActiveAt: ctx.now,
      }
    }

    if (hasCpuSpike(ctx)) {
      return {
        state: "active" as State,
        reason: "cpu_spike",
        lastActiveAt: ctx.now,
      }
    }

    if (hasRecentActivity(ctx)) {
      return {
        state: "active" as State,
        reason: "recent_event",
        lastActiveAt: ctx.lastActivityAt,
      }
    }

    if (hasSustainedCpu(ctx)) {
      return {
        state: "active" as State,
        reason: "sustained_cpu",
        lastActiveAt: ctx.now,
      }
    }

    // Priority 4: Hold active state
    if (!isHoldExpired(ctx.previousActiveAt, ctx.now, ctx.holdMs)) {
      return {
        state: "active" as State,
        reason: "hold_active",
        lastActiveAt: ctx.previousActiveAt,
      }
    }

    // Default: idle
    return {
      state: "idle" as State,
      reason: "no_signal",
    }
  })

/**
 * Derive state synchronously (for non-Effect contexts)
 */
export const deriveStateSync = (ctx: ActivityContext): StateResult => {
  const runnable = Effect.runSync(deriveState(ctx))
  return runnable
}

// ============================================================================
// Provider-Specific Derivations
// ============================================================================

/** Codex-specific activity derivation */
export const deriveCodexState = (
  input: Omit<ActivityContext, "spikeMultiplier" | "spikeMinimum" | "sustainMs" | "inFlightGraceMs"> &
    Partial<Pick<ActivityContext, "spikeMultiplier" | "spikeMinimum" | "sustainMs" | "inFlightGraceMs">>
): Effect.Effect<StateResult> => {
  const ctx: ActivityContext = {
    ...input,
    spikeMultiplier: input.spikeMultiplier ?? 10,
    spikeMinimum: input.spikeMinimum ?? 25,
    sustainMs: input.sustainMs ?? 500,
    inFlightGraceMs: input.inFlightGraceMs ?? 0,
  }
  return deriveState(ctx)
}

/** OpenCode-specific activity derivation */
export const deriveOpenCodeState = (
  input: Omit<ActivityContext, "spikeMultiplier" | "spikeMinimum" | "sustainMs" | "inFlightGraceMs" | "strictInFlight"> &
    Partial<Pick<ActivityContext, "spikeMultiplier" | "spikeMinimum" | "sustainMs" | "inFlightGraceMs" | "strictInFlight">> & {
      status?: string
      isServer?: boolean
    }
): Effect.Effect<StateResult> =>
  Effect.gen(function* () {
    const ctx: ActivityContext = {
      ...input,
      spikeMultiplier: input.spikeMultiplier ?? 10,
      spikeMinimum: input.spikeMinimum ?? 25,
      sustainMs: input.sustainMs ?? 500,
      inFlightGraceMs: input.inFlightGraceMs ?? 0,
      strictInFlight: input.strictInFlight ?? true,
    }

    // Check for idle status
    const statusIsIdle = input.status && /idle|stopped|paused/.test(input.status)
    if (statusIsIdle && !hasInFlightSignal(ctx)) {
      return {
        state: "idle",
        reason: "status_idle",
      }
    }

    return yield* deriveState(ctx)
  })

/** Claude-specific activity derivation */
export const deriveClaudeState = (
  input: Omit<ActivityContext, "spikeMultiplier" | "spikeMinimum" | "sustainMs" | "inFlightGraceMs" | "strictInFlight" | "holdMs"> &
    Partial<Pick<ActivityContext, "spikeMultiplier" | "spikeMinimum" | "sustainMs" | "inFlightGraceMs" | "strictInFlight" | "holdMs">> & {
      startGraceMs?: number
    }
): Effect.Effect<StateResult> =>
  Effect.gen(function* () {
    const startGraceMs = input.startGraceMs ?? 1200
    const startedRecently = input.lastActivityAt && 
      (input.now - input.lastActivityAt <= startGraceMs)

    const ctx: ActivityContext = {
      ...input,
      spikeMultiplier: input.spikeMultiplier ?? 10,
      spikeMinimum: input.spikeMinimum ?? 25,
      sustainMs: input.sustainMs ?? 1000,
      inFlightGraceMs: input.inFlightGraceMs ?? 0,
      strictInFlight: input.strictInFlight ?? false,
      holdMs: input.holdMs ?? 0,
    }

    // Grace period after start
    if (startedRecently) {
      return {
        state: "active",
        reason: "start_grace",
        lastActiveAt: ctx.now,
      }
    }

    return yield* deriveState(ctx)
  })
