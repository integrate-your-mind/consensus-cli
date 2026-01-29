/**
 * Activity state machine types and interfaces
 */

import type { AgentState } from "../types.js"

/** Possible activity states */
export type State = AgentState // "active" | "idle" | "error"

/** Context for state transitions */
export interface ActivityContext {
  /** Current CPU usage percentage */
  readonly cpu: number
  
  /** Whether an error has been detected */
  readonly hasError: boolean
  
  /** Timestamp of last activity event */
  readonly lastActivityAt?: number
  
  /** Timestamp of last in-flight signal */
  readonly lastInFlightSignalAt?: number
  
  /** Whether operation is currently in-flight */
  readonly inFlight: boolean
  
  /** Current timestamp */
  readonly now: number
  
  /** Previously recorded active timestamp (for hold) */
  readonly previousActiveAt?: number
  
  /** CPU threshold for active state */
  readonly cpuThreshold: number
  
  /** Window after event to consider active (ms) */
  readonly eventWindowMs: number
  
  /** How long to hold active state (ms) */
  readonly holdMs: number
  
  /** Idle timeout for in-flight operations (ms) */
  readonly inFlightIdleMs?: number
  
  /** Multiplier for spike detection */
  readonly spikeMultiplier: number
  
  /** Minimum spike threshold */
  readonly spikeMinimum: number
  
  /** Duration of CPU above threshold (ms) */
  readonly cpuActiveMs: number
  
  /** Minimum duration for sustained CPU */
  readonly sustainMs: number
  
  /** Grace period after in-flight signal (ms) */
  readonly inFlightGraceMs: number
  
  /** Whether to strictly require in-flight for active */
  readonly strictInFlight: boolean
}

/** Result of state derivation */
export interface StateResult {
  readonly state: State
  readonly reason: string
  readonly lastActiveAt?: number
}

/** State transition definition */
export interface Transition {
  readonly from: State | "*"
  readonly to: State
  readonly condition: (ctx: ActivityContext) => boolean
  readonly reason: string
  readonly priority: number
}
