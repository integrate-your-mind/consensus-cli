/**
 * Activity state machine module
 * Provides Effect-based state derivation for agent activity tracking
 */

export type {
  ActivityContext,
  State,
  StateResult,
  Transition,
} from "./types.js"

export {
  deriveState,
  deriveStateSync,
  deriveCodexState,
  deriveOpenCodeState,
  deriveClaudeState,
} from "./machine.js"
