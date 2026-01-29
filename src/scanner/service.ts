/**
 * Scanner service implementation using Effect
 */

import { Effect, Context, Layer, Option } from "effect"
import type { Scanner, ScanOptions, PsProcess, ProcessUsage } from "./types.js"
import type { SnapshotPayload } from "../types.js"
import { Config, ConfigLive } from "../config/service.js"

// ============================================================================
// Service Tag
// ============================================================================

export class ScannerService extends Context.Tag("ScannerService")<
  ScannerService,
  Scanner
>() {}

// ============================================================================
// Implementation (placeholder - full implementation would integrate with scan.ts logic)
// ============================================================================

/** Placeholder implementation that delegates to existing scanCodexProcesses */
export const ScannerLive = Layer.effect(
  ScannerService,
  Effect.gen(function* () {
    // This will be replaced with full Effect-based implementation
    // For now, it provides the service interface
    return {
      scan: (options: ScanOptions) =>
        Effect.tryPromise({
          try: async () => {
            // Import dynamically to avoid circular dependency
            const { scanCodexProcesses } = await import("../scan.js")
            return scanCodexProcesses(options)
          },
          catch: (e) => new Error(`Scan failed: ${e}`),
        }).pipe(
          Effect.catchAll(() => 
            Effect.succeed({ ts: Date.now(), agents: [] } as SnapshotPayload)
          )
        ),
      
      getProcessList: () =>
        Effect.tryPromise({
          try: async () => {
            const { default: psList } = await import("ps-list")
            return psList() as Promise<PsProcess[]>
          },
          catch: (e) => new Error(`Failed to get process list: ${e}`),
        }).pipe(
          Effect.catchAll(() => Effect.succeed([] as PsProcess[]))
        ),
      
      getUsage: (pids) =>
        Effect.tryPromise({
          try: async () => {
            const pidusage = await import("pidusage")
            const result = await pidusage.default([...pids] as number[])
            // Transform to our ProcessUsage type
            const transformed: Record<number, ProcessUsage> = {}
            for (const [pid, status] of Object.entries(result)) {
              transformed[Number(pid)] = {
                cpu: status.cpu,
                memory: status.memory,
                elapsed: (status as { elapsed?: number }).elapsed,
              }
            }
            return transformed
          },
          catch: (e) => new Error(`Failed to get usage: ${e}`),
        }).pipe(
          Effect.catchAll(() => Effect.succeed({} as Record<number, ProcessUsage>))
        ),
      
      getCwd: (pid) =>
        Effect.tryPromise({
          try: async () => {
            // Use lsof or ps to get cwd
            const { execFile } = await import("child_process")
            const { promisify } = await import("util")
            const execFileAsync = promisify(execFile)
            
            try {
              const { stdout } = await execFileAsync("ps", [
                "-o",
                "cwd=",
                "-p",
                String(pid),
              ])
              const cwd = stdout.trim()
              return cwd ? Option.some(cwd) : Option.none()
            } catch {
              return Option.none()
            }
          },
          catch: () => Option.none<string>(),
        }).pipe(Effect.catchAll(() => Effect.succeed(Option.none()))),
    }
  })
)

// ============================================================================
// Layer Composition
// ============================================================================

/** Complete scanner layer with all dependencies */
export const ScannerLayer = ScannerLive.pipe(
  Layer.provide(ConfigLive)
)
