/**
 * Effect-based caching for scanner
 * Uses Ref for mutable state within Effect
 */

import { Effect, Ref, Option } from "effect"
import { Config } from "../config/service.js"
import type { ProcessCache, PsProcess, ProcessUsage } from "./types.js"

// ============================================================================
// Cache Operations
// ============================================================================

/** Create a new empty cache */
export const makeCache = (): ProcessCache => ({
  at: 0,
  processes: [],
  usage: {},
  cwds: new Map(),
  startTimes: new Map(),
  jsonlByPid: new Map(),
})

/** Check if cache is valid for given TTL */
export const isValid = (
  cache: ProcessCache,
  now: number,
  ttlMs: number
): boolean => {
  if (cache.processes.length === 0) return false
  return now - cache.at < ttlMs
}

/** Get TTL based on scan mode */
export const getTtl = (
  mode: "fast" | "full",
  config: { readonly ttlMs: number; readonly fastTtlMs: number }
): number => {
  return mode === "fast" ? config.fastTtlMs : config.ttlMs
}

// ============================================================================
// Effect-based Cache Service
// ============================================================================

/** Cache service interface */
export interface CacheService {
  readonly get: (mode: "fast" | "full") => Effect.Effect<Option.Option<ProcessCache>, never, Config>
  readonly set: (cache: ProcessCache) => Effect.Effect<void>
  readonly updateUsage: (usage: Record<number, ProcessUsage>) => Effect.Effect<void>
  readonly invalidate: () => Effect.Effect<void>
}

/** Create cache service implementation */
export const makeCacheService = (): Effect.Effect<CacheService, never, Config> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(makeCache())
    
    return {
      get: (mode) => Effect.gen(function* () {
        const cache = yield* Ref.get(ref)
        const config = yield* Config
        const now = Date.now()
        const ttl = getTtl(mode, config.scan.processCache)
        
        if (isValid(cache, now, ttl)) {
          return Option.some(cache)
        }
        return Option.none()
      }),
      
      set: (cache) => Ref.set(ref, { ...cache, at: Date.now() }),
      
      updateUsage: (usage) => Ref.update(ref, cache => ({
        ...cache,
        usage: { ...cache.usage, ...usage },
      })),
      
      invalidate: () => Ref.set(ref, makeCache()),
    }
  })

// ============================================================================
// Synchronous Cache (for compatibility with existing code)
// ============================================================================

/** Simple mutable cache for use in async functions */
export class MutableCache {
  private cache: ProcessCache = makeCache()
  
  get(): ProcessCache {
    return this.cache
  }
  
  set(cache: Omit<ProcessCache, "at">): void {
    this.cache = { ...cache, at: Date.now() }
  }
  
  isValid(now: number, ttlMs: number): boolean {
    return isValid(this.cache, now, ttlMs)
  }
  
  updateUsage(usage: Record<number, ProcessUsage>): void {
    this.cache = {
      ...this.cache,
      usage: { ...this.cache.usage, ...usage },
    }
  }
  
  invalidate(): void {
    this.cache = makeCache()
  }
}
