/**
 * Configuration module using Effect Schema
 * 
 * Provides type-safe, validated configuration with defaults.
 * All environment variables are mapped to structured config objects.
 * 
 * @example
 * ```ts
 * import { Config, ConfigLive } from "./config/index.js"
 * 
 * const program = Effect.gen(function* () {
 *   const config = yield* Config
 *   console.log(`Server will start on ${config.server.host}:${config.server.port}`)
 * })
 * 
 * // Run with live config from environment
 * const runnable = program.pipe(Effect.provide(ConfigLive))
 * ```
 */

// Schema definitions and types
export {
  AppConfig,
  ServerConfig,
  ScanConfig,
  CacheConfig,
  CodexConfig,
  OpenCodeConfig,
  ClaudeConfig,
  ActivityConfig,
  RedactConfig,
  DebugConfig,
  type AppConfigType,
  type ServerConfigType,
  type ScanConfigType,
  type CodexConfigType,
  type OpenCodeConfigType,
  type ClaudeConfigType,
  type ActivityConfigType,
  type RedactConfigType,
  type DebugConfigType,
} from "./schema.js"

// Environment parsing
export {
  decodeFromEnv,
  decodeFromEnvWithDefaults,
  loadConfigSync,
  loadConfigSafe,
} from "./fromEnv.js"

// Service and layers
export {
  Config,
  ConfigLive,
  ConfigFromValue,
  ConfigForTest,
  accessWith,
  serverConfig,
  scanConfig,
  codexConfig,
  opencodeConfig,
  claudeConfig,
  isDebugActivity,
  isDebugOpencode,
  isProfileEnabled,
  profileThresholdMs,
} from "./service.js"
