/**
 * Scanner service types
 */

import type { Effect, Option } from "effect"
import type { SnapshotPayload } from "../types.js"

/** Process information from ps-list */
export interface PsProcess {
  readonly pid: number
  readonly ppid?: number
  readonly name?: string
  readonly cmd?: string
}

/** Process usage stats */
export interface ProcessUsage {
  readonly cpu: number
  readonly memory: number
  readonly elapsed?: number
}

/** Scan mode - fast uses caches, full does complete scan */
export type ScanMode = "fast" | "full"

/** Scan options */
export interface ScanOptions {
  readonly mode?: ScanMode
  readonly includeActivity?: boolean
}

/** Cached process data */
export interface ProcessCache {
  readonly at: number
  readonly processes: readonly PsProcess[]
  readonly usage: Readonly<Record<number, ProcessUsage>>
  readonly cwds: ReadonlyMap<number, string>
  readonly startTimes: ReadonlyMap<number, number>
  readonly jsonlByPid: ReadonlyMap<number, readonly string[]>
}

/** Process detector interface */
export interface ProcessDetector {
  readonly name: string
  isMatch(cmd: string | undefined, name: string | undefined): boolean
  inferKind(cmd: string): string
}

/** Scanner service interface */
export interface Scanner {
  readonly scan: (options: ScanOptions) => Effect.Effect<SnapshotPayload>
  readonly getProcessList: () => Effect.Effect<readonly PsProcess[]>
  readonly getUsage: (pids: readonly number[]) => Effect.Effect<Readonly<Record<number, ProcessUsage>>>
  readonly getCwd: (pid: number) => Effect.Effect<Option.Option<string>>
}
