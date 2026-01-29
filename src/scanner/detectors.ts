/**
 * Process detectors for different agent types
 * Uses Effect Match for declarative pattern matching
 */

import { Match, Option } from "effect"
import type { ProcessDetector } from "./types.js"

// ============================================================================
// Utility Functions
// ============================================================================

const stripQuotes = (value: string): string =>
  value.replace(/^["']|["']$/g, "")

const basename = (filepath: string): string => {
  const parts = filepath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filepath
}

// ============================================================================
// Detection Predicates
// ============================================================================

const hasCodexVendorPath = (cmdLine: string): boolean =>
  /[\\/]+codex[\\/]+vendor[\\/]+/i.test(cmdLine)

const hasCodexToken = (cmdLine: string): boolean =>
  /(?:^|\s|[\\/])codex(\.exe)?(?:\s|$)/i.test(cmdLine) ||
  /[\\/]+codex(\.exe)?/i.test(cmdLine)

const isCodexBinary = (value: string | undefined): boolean => {
  if (!value) return false
  const cleaned = stripQuotes(value)
  const base = basename(cleaned).toLowerCase()
  return base === "codex" || base === "codex.exe"
}

// ============================================================================
// Codex Detector
// ============================================================================

export const codexDetector: ProcessDetector = {
  name: "codex",
  
  isMatch(cmd, name) {
    if (!cmd && !name) return false
    
    return Match.value({ cmd, name }).pipe(
      // Exclude OpenCode and Claude
      Match.when(
        ({ cmd, name }) => isOpenCodeProcess(cmd, name) || isClaudeProcess(cmd, name),
        () => false
      ),
      // Exclude vendor processes
      Match.when(
        ({ cmd }) => hasCodexVendorPath(cmd || ""),
        () => false
      ),
      // Match by binary name
      Match.when(
        ({ name }) => isCodexBinary(name),
        () => true
      ),
      // Match by command first token
      Match.when(
        ({ cmd }) => isCodexBinary(cmd?.split(/\s+/g)[0]),
        () => true
      ),
      // Match by token presence
      Match.when(
        ({ cmd }) => hasCodexToken(cmd || ""),
        () => true
      ),
      Match.orElse(() => false)
    )
  },
  
  inferKind(cmd) {
    if (cmd.includes(" app-server")) return "app-server"
    if (cmd.includes(" exec")) return "exec"
    return "tui"
  }
}

// ============================================================================
// OpenCode Detector
// ============================================================================

export const isOpenCodeProcess = (
  cmd: string | undefined,
  name: string | undefined
): boolean => {
  if (!cmd && !name) return false
  if (name?.toLowerCase() === "opencode") return true
  if (!cmd) return false
  
  const firstToken = cmd.trim().split(/\s+/)[0]
  const base = basename(firstToken).toLowerCase()
  return base === "opencode" || base === "opencode.exe"
}

export const opencodeDetector: ProcessDetector = {
  name: "opencode",
  
  isMatch(cmd, name) {
    return isOpenCodeProcess(cmd, name)
  },
  
  inferKind(cmd) {
    if (cmd.includes(" serve")) return "opencode-server"
    if (cmd.includes(" web")) return "opencode-server"
    if (/opencode\s+run/i.test(cmd)) return "opencode-cli"
    return "opencode-tui"
  }
}

// ============================================================================
// Claude Detector
// ============================================================================

export const isClaudeProcess = (
  cmd: string | undefined,
  name: string | undefined
): boolean => {
  if (!cmd && !name) return false
  if (name === "claude") return true
  if (!cmd) return false
  
  const firstToken = cmd.trim().split(/\s+/)[0]
  const base = basename(firstToken)
  return base === "claude" || base === "claude.exe"
}

export const claudeDetector: ProcessDetector = {
  name: "claude",
  
  isMatch(cmd, name) {
    return isClaudeProcess(cmd, name)
  },
  
  inferKind(cmd) {
    if (/\b(print|prompt)\b/i.test(cmd)) return "claude-cli"
    return "claude-tui"
  }
}

// ============================================================================
// Detector Registry
// ============================================================================

export const detectors = [
  codexDetector,
  opencodeDetector,
  claudeDetector,
] as const

export type DetectorName = typeof detectors[number]["name"]

/** Find matching detector for a process */
export const findDetector = (
  cmd: string | undefined,
  name: string | undefined
): Option.Option<ProcessDetector> => {
  for (const detector of detectors) {
    if (detector.isMatch(cmd, name)) {
      return Option.some(detector)
    }
  }
  return Option.none()
}
