/**
 * Config service for dependency injection using Effect Context
 */

import { Context, Effect, Layer } from "effect"
import type { AppConfigType } from "./schema.js"
import { loadConfigSafe } from "./fromEnv.js"

// ============================================================================
// Service Tag
// ============================================================================

/**
 * Tag for the Config service
 * Use this to access configuration in Effect programs
 * 
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const config = yield* Config
 *   yield* Effect.log(`Server port: ${config.server.port}`)
 * })
 * ```
 */
export class Config extends Context.Tag("Config")<Config, AppConfigType>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

/**
 * Layer that loads config from environment variables
 */
export const ConfigLive = Layer.effect(
  Config,
  Effect.sync(loadConfigSafe)
)

/**
 * Layer with explicit config value (useful for testing)
 */
export const ConfigFromValue = (value: AppConfigType) =>
  Layer.succeed(Config, value)

/**
 * Layer for testing with partial config (defaults fill in the rest)
 */
export const ConfigForTest = (partial: Partial<AppConfigType> = {}) =>
  Layer.effect(
    Config,
    Effect.sync(() => {
      const defaults = loadConfigSafe()
      return { ...defaults, ...partial }
    })
  )

// ============================================================================
// Accessor Helpers
// ============================================================================

/**
 * Access a specific portion of the config
 * 
 * @example
 * ```ts
 * const getServerPort = Config.accessWith(c => c.server.port)
 * ```
 */
export const accessWith = <A>(f: (config: AppConfigType) => A): Effect.Effect<A, never, Config> =>
  Config.pipe(Effect.map(f))

/**
 * Access server configuration
 */
export const serverConfig = accessWith(c => c.server)

/**
 * Access scan configuration
 */
export const scanConfig = accessWith(c => c.scan)

/**
 * Access Codex configuration
 */
export const codexConfig = accessWith(c => c.codex)

/**
 * Access OpenCode configuration
 */
export const opencodeConfig = accessWith(c => c.opencode)

/**
 * Access Claude configuration
 */
export const claudeConfig = accessWith(c => c.claude)

/**
 * Check if debug mode is enabled
 */
export const isDebugActivity = accessWith(c => c.debug.activity)
export const isDebugOpencode = accessWith(c => c.debug.opencode)
export const isProfileEnabled = accessWith(c => c.debug.profile)

/**
 * Get profile threshold in milliseconds
 */
export const profileThresholdMs = accessWith(c => c.debug.profileMs)
