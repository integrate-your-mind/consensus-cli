/**
 * Configuration schema definitions using Effect Schema
 * This module provides type-safe, validated configuration with defaults
 */

import { Schema } from "effect"

// ============================================================================
// Primitive Config Types
// ============================================================================

/** Positive number schema with default */
const PositiveNumber = Schema.Number.pipe(
  Schema.positive(),
  Schema.annotations({ description: "Must be a positive number" })
)

/** Port number schema (1-65535) */
const PortNumber = Schema.Number.pipe(
  Schema.between(1, 65535),
  Schema.annotations({ description: "Valid port number (1-65535)" })
)

// ============================================================================
// Provider-Specific Configs
// ============================================================================

/** Codex activity detection configuration */
export const CodexConfig = Schema.Struct({
  /** CPU threshold percentage to consider active */
  cpuThreshold: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 1 })
  ),
  
  /** Minimum CPU duration before considering active (ms) */
  sustainMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 500 })
  ),
  
  /** Window after last event to consider active (ms) */
  eventWindowMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 30000 })
  ),
  
  /** How long to hold active state after activity ends (ms) */
  holdMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 0 })
  ),
  
  /** Idle timeout for in-flight operations (ms) */
  inFlightIdleMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 30000 })
  ),
  
  /** Hard timeout for in-flight operations (ms) */
  inFlightTimeoutMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 5000 })
  ),
  
  /** Multiplier for CPU spike detection */
  spikeMultiplier: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 10 })
  ),
  
  /** Minimum CPU spike threshold */
  spikeMinimum: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 25 })
  ),
  
  /** Grace period after in-flight signal (ms) */
  inFlightGraceMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 0 })
  ),
  
  /** Whether to require in-flight signal for active state */
  strictInFlight: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => true })
  ),
  
  /** Window after mtime change to consider active (ms) */
  mtimeWindowMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 0 })
  ),
})

/** OpenCode configuration */
export const OpenCodeConfig = Schema.Struct({
  host: Schema.String.pipe(
    Schema.optionalWith({ default: () => "127.0.0.1" })
  ),
  
  port: PortNumber.pipe(
    Schema.optionalWith({ default: () => 4096 })
  ),
  
  timeoutMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 5000 })
  ),
  
  pollMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 2000 })
  ),
  
  autostart: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => true })
  ),
  
  enableEvents: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => true })
  ),
  
  home: Schema.String.pipe(Schema.optional),
  
  eventWindowMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 0 })
  ),
  
  staleActiveMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 0 })
  ),
  
  holdMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 0 })
  ),
  
  strictInFlight: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => true })
  ),
  
  inFlightIdleMs: Schema.Number.pipe(Schema.optional),
  inFlightTimeoutMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 15000 })
  ),
})

/** Claude configuration */
export const ClaudeConfig = Schema.Struct({
  cpuThreshold: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 1 })
  ),
  
  sustainMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 1000 })
  ),
  
  startGraceMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 1200 })
  ),
  
  spikeMinimum: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 25 })
  ),
})

// ============================================================================
// Scanner Configuration
// ============================================================================

/** Process cache configuration */
export const CacheConfig = Schema.Struct({
  ttlMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 1000 })
  ),
  fastTtlMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 500 })
  ),
})

/** Scan behavior configuration */
export const ScanConfig = Schema.Struct({
  timeoutMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 5000 })
  ),
  
  stallMs: Schema.Number.pipe(Schema.optional),
  stallCheckMs: Schema.Number.pipe(Schema.optional),
  
  pollMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 250 })
  ),
  
  processCache: CacheConfig.pipe(
    Schema.optionalWith({ default: () => ({ ttlMs: 1000, fastTtlMs: 500 }) })
  ),
  
  sessionCache: CacheConfig.pipe(
    Schema.optionalWith({ default: () => ({ ttlMs: 1000, fastTtlMs: 500 }) })
  ),
})

// ============================================================================
// Main Application Config
// ============================================================================

/** Server configuration */
export const ServerConfig = Schema.Struct({
  host: Schema.String.pipe(
    Schema.optionalWith({ default: () => "127.0.0.1" })
  ),
  
  port: PortNumber.pipe(
    Schema.optionalWith({ default: () => 8787 })
  ),
})

/** Activity tracking configuration */
export const ActivityConfig = Schema.Struct({
  cpuThreshold: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 1 })
  ),
  
  holdMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 600000 })
  ),
  
  idleHoldMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 200 })
  ),
  
  staleSpanMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 15000 })
  ),
})

/** PII redaction configuration */
export const RedactConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => true })
  ),
  strict: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => false })
  ),
})

/** Debug flags configuration */
export const DebugConfig = Schema.Struct({
  activity: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => false })
  ),
  
  opencode: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => false })
  ),
  
  profile: Schema.Boolean.pipe(
    Schema.optionalWith({ default: () => false })
  ),
  
  profileMs: Schema.Number.pipe(
    Schema.optionalWith({ default: () => 25 })
  ),
})

/** Complete application configuration */
export const AppConfig = Schema.Struct({
  server: ServerConfig.pipe(
    Schema.optionalWith({ default: () => ({ host: "127.0.0.1", port: 8787 }) })
  ),
  scan: ScanConfig.pipe(
    Schema.optionalWith({ default: () => ({ 
      timeoutMs: 5000, 
      pollMs: 250,
      processCache: { ttlMs: 1000, fastTtlMs: 500 },
      sessionCache: { ttlMs: 1000, fastTtlMs: 500 },
    }) })
  ),
  activity: ActivityConfig.pipe(
    Schema.optionalWith({ default: () => ({ 
      cpuThreshold: 1, 
      holdMs: 3000, 
      idleHoldMs: 200, 
      staleSpanMs: 15000 
    }) })
  ),
  codex: CodexConfig.pipe(
    Schema.optionalWith({ default: () => ({ 
      cpuThreshold: 1,
      sustainMs: 500,
      eventWindowMs: 30000,
      holdMs: 3000,
      inFlightIdleMs: 30000,
      inFlightTimeoutMs: 5000,
      spikeMultiplier: 10,
      spikeMinimum: 25,
      inFlightGraceMs: 0,
      strictInFlight: true,
      mtimeWindowMs: 0,
    }) })
  ),
  opencode: OpenCodeConfig.pipe(
    Schema.optionalWith({ default: () => ({ 
      host: "127.0.0.1",
      port: 4096,
      timeoutMs: 5000,
      pollMs: 2000,
      autostart: true,
      enableEvents: true,
      eventWindowMs: 0,
      staleActiveMs: 0,
      holdMs: 3000,
      strictInFlight: true,
      inFlightTimeoutMs: 15000,
    }) })
  ),
  claude: ClaudeConfig.pipe(
    Schema.optionalWith({ default: () => ({ 
      cpuThreshold: 1,
      sustainMs: 1000,
      startGraceMs: 1200,
      spikeMinimum: 25,
    }) })
  ),
  redact: RedactConfig.pipe(
    Schema.optionalWith({ default: () => ({ enabled: true, strict: false }) })
  ),
  debug: DebugConfig.pipe(
    Schema.optionalWith({ default: () => ({ 
      activity: false, 
      opencode: false, 
      profile: false, 
      profileMs: 25 
    }) })
  ),
  
  /** Optional regex for process matching */
  processMatch: Schema.String.pipe(Schema.optional),
  
  /** Codex home directory override */
  codexHome: Schema.String.pipe(Schema.optional),
})

// ============================================================================
// Type Exports
// ============================================================================

export type AppConfigType = typeof AppConfig.Type
export type ServerConfigType = typeof ServerConfig.Type
export type ScanConfigType = typeof ScanConfig.Type
export type CodexConfigType = typeof CodexConfig.Type
export type OpenCodeConfigType = typeof OpenCodeConfig.Type
export type ClaudeConfigType = typeof ClaudeConfig.Type
export type ActivityConfigType = typeof ActivityConfig.Type
export type RedactConfigType = typeof RedactConfig.Type
export type DebugConfigType = typeof DebugConfig.Type
