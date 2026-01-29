/**
 * Scanner module for process detection and monitoring
 */

export type {
  PsProcess,
  ProcessUsage,
  ScanMode,
  ScanOptions,
  ProcessCache,
  ProcessDetector,
  Scanner,
} from "./types.js"

export {
  codexDetector,
  opencodeDetector,
  claudeDetector,
  isOpenCodeProcess,
  isClaudeProcess,
  detectors,
  findDetector,
} from "./detectors.js"

export {
  makeCache,
  isValid,
  getTtl,
  makeCacheService,
  MutableCache,
  type CacheService,
} from "./cache.js"

export {
  ScannerService,
  ScannerLive,
  ScannerLayer,
} from "./service.js"
