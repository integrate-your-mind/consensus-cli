/**
 * Environment variable parser using Effect Schema
 * Maps CONSENSUS_* environment variables to typed configuration
 */

import { Effect, Option, Schema, ParseResult } from "effect"
import {
  AppConfig,
  type AppConfigType,
} from "./schema.js"

// ============================================================================
// Environment Variable Parsers
// ============================================================================

/** Parse a string to number, returning None if invalid */
const parseNumber = (value: string | undefined): Option.Option<number> => {
  if (value === undefined) return Option.none()
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Option.some(parsed) : Option.none()
}

/** Parse a boolean from various string representations */
const parseBoolean = (value: string | undefined): Option.Option<boolean> => {
  if (value === undefined) return Option.none()
  const normalized = value.toLowerCase().trim()
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return Option.some(true)
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return Option.some(false)
  }
  return Option.none()
}

// ============================================================================
// Config Builders
// ============================================================================

const buildServerConfig = () => ({
  host: process.env.CONSENSUS_HOST,
  port: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_PORT)),
})

const buildScanConfig = () => {
  const timeoutMs = Option.getOrUndefined(parseNumber(process.env.CONSENSUS_SCAN_TIMEOUT_MS))
  const stallMsRaw = Option.getOrUndefined(parseNumber(process.env.CONSENSUS_SCAN_STALL_MS))
  const stallMs = stallMsRaw ?? (timeoutMs ? Math.floor(timeoutMs * 0.6) : undefined)
  
  return {
    timeoutMs,
    stallMs,
    stallCheckMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_SCAN_STALL_CHECK_MS)) ?? 
      (stallMs ? Math.min(1000, Math.max(250, stallMs)) : undefined),
    pollMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_POLL_MS)),
    processCache: {
      ttlMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_PROCESS_CACHE_MS)),
      fastTtlMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_PROCESS_CACHE_FAST_MS)),
    },
    sessionCache: {
      ttlMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_SESSION_CACHE_MS)),
      fastTtlMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_SESSION_CACHE_FAST_MS)),
    },
  }
}

const buildCodexConfig = () => ({
  cpuThreshold: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CPU_ACTIVE ?? process.env.CONSENSUS_CODEX_CPU_ACTIVE)),
  sustainMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_CPU_SUSTAIN_MS)),
  eventWindowMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_EVENT_ACTIVE_MS ?? process.env.CONSENSUS_EVENT_ACTIVE_MS)),
  holdMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_ACTIVE_HOLD_MS)),
  inFlightIdleMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_INFLIGHT_IDLE_MS)),
  inFlightTimeoutMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_INFLIGHT_TIMEOUT_MS)),
  spikeMultiplier: undefined, // Derived from cpuThreshold * 10
  spikeMinimum: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_CPU_SPIKE)),
  inFlightGraceMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_INFLIGHT_GRACE_MS)),
  strictInFlight: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_CODEX_STRICT_INFLIGHT)),
  mtimeWindowMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CODEX_MTIME_ACTIVE_MS)),
})

const buildOpenCodeConfig = () => ({
  host: process.env.CONSENSUS_OPENCODE_HOST,
  port: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_PORT)),
  timeoutMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_TIMEOUT_MS)),
  pollMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_POLL_MS)),
  autostart: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_OPENCODE_AUTOSTART)) ?? true,
  enableEvents: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_OPENCODE_EVENTS)) ?? true,
  home: process.env.CONSENSUS_OPENCODE_HOME,
  eventWindowMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_EVENT_ACTIVE_MS)),
  staleActiveMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_STALE_ACTIVE_MS)),
  cpuWindowMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_CPU_ACTIVE_MS)),
  holdMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_ACTIVE_HOLD_MS)),
  strictInFlight: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_OPENCODE_STRICT_INFLIGHT)),
  inFlightIdleMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS ?? process.env.CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS)),
  inFlightTimeoutMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS)),
})

const buildClaudeConfig = () => ({
  cpuThreshold: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CLAUDE_CPU_ACTIVE ?? process.env.CONSENSUS_CPU_ACTIVE)),
  sustainMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CLAUDE_CPU_SUSTAIN_MS)),
  startGraceMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CLAUDE_START_ACTIVE_MS)),
  spikeMinimum: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CLAUDE_CPU_SPIKE)),
})

const buildActivityConfig = () => ({
  cpuThreshold: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_CPU_ACTIVE)),
  holdMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_ACTIVE_HOLD_MS)),
  idleHoldMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_IDLE_HOLD_MS)),
  staleSpanMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_SPAN_STALE_MS)),
})

const buildRedactConfig = () => ({
  enabled: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_REDACT_PII)) ?? true,
})

const buildDebugConfig = () => ({
  activity: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_DEBUG_ACTIVITY)),
  opencode: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_DEBUG_OPENCODE)),
  profile: Option.getOrUndefined(parseBoolean(process.env.CONSENSUS_PROFILE)),
  profileMs: Option.getOrUndefined(parseNumber(process.env.CONSENSUS_PROFILE_MS)),
})

// ============================================================================
// Main Decode Function
// ============================================================================

/** Raw config from environment (before schema validation) */
const buildRawConfig = () => ({
  server: buildServerConfig(),
  scan: buildScanConfig(),
  activity: buildActivityConfig(),
  codex: buildCodexConfig(),
  opencode: buildOpenCodeConfig(),
  claude: buildClaudeConfig(),
  redact: buildRedactConfig(),
  debug: buildDebugConfig(),
  processMatch: process.env.CONSENSUS_PROCESS_MATCH,
  codexHome: process.env.CONSENSUS_CODEX_HOME,
})

/**
 * Decode configuration from environment variables
 * Returns an Effect that fails with validation errors if config is invalid
 */
export const decodeFromEnv: Effect.Effect<AppConfigType, ParseResult.ParseError> =
  Schema.decode(AppConfig)(buildRawConfig())

/**
 * Decode configuration with defaults for missing values
 * Never fails - uses defaults for invalid/missing values
 */
export const decodeFromEnvWithDefaults: Effect.Effect<AppConfigType, never> =
  decodeFromEnv.pipe(
    Effect.catchAll(() => Effect.sync(() => Schema.decodeUnknownSync(AppConfig)({})))
  )

/**
 * Synchronous config loading for use in non-Effect contexts
 * Throws on validation error
 */
export const loadConfigSync = (): AppConfigType => {
  const raw = buildRawConfig()
  return Schema.decodeUnknownSync(AppConfig)(raw)
}

/**
 * Safe synchronous config loading with defaults
 * Never throws
 */
export const loadConfigSafe = (): AppConfigType => {
  try {
    return loadConfigSync()
  } catch {
    // Return minimal valid config with all defaults
    return Schema.decodeUnknownSync(AppConfig)({})
  }
}
