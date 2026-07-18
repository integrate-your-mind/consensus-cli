import { createHash } from "crypto";
import type { EventSummary, WorkSummary } from "../types.js";
import type { ClaudeEvent, ClaudeSessionState } from "../claude/types.js";

export const CLAUDE_STALE_TTL_MS = Number(
  process.env.CONSENSUS_CLAUDE_EVENT_TTL_MS || 30 * 60 * 1000
);
const INFLIGHT_TIMEOUT_MS = Number(
  process.env.CONSENSUS_CLAUDE_INFLIGHT_TIMEOUT_MS || 15000
);
const MAX_EVENTS = 50;
const MAX_METADATA_LABEL_LENGTH = 160;
export const CLAUDE_EVENT_LOG_VERSION = 1 as const;

const CANONICAL_TYPES: Record<string, string> = {
  setup: "Setup",
  sessionstart: "SessionStart",
  sessionend: "SessionEnd",
  userpromptsubmit: "UserPromptSubmit",
  userpromptexpansion: "UserPromptExpansion",
  messagedisplay: "MessageDisplay",
  pretooluse: "PreToolUse",
  posttooluse: "PostToolUse",
  posttoolusefailure: "PostToolUseFailure",
  posttoolbatch: "PostToolBatch",
  permissionrequest: "PermissionRequest",
  permissiondenied: "PermissionDenied",
  notification: "Notification",
  subagentstart: "SubagentStart",
  subagentstop: "SubagentStop",
  taskcreated: "TaskCreated",
  taskcompleted: "TaskCompleted",
  stop: "Stop",
  stopfailure: "StopFailure",
  teammateidle: "TeammateIdle",
  configchange: "ConfigChange",
  cwdchanged: "CwdChanged",
  filechanged: "FileChanged",
  worktreecreate: "WorktreeCreate",
  worktreeremove: "WorktreeRemove",
  instructionsloaded: "InstructionsLoaded",
  precompact: "PreCompact",
  postcompact: "PostCompact",
  elicitation: "Elicitation",
  elicitationresult: "ElicitationResult",
};

const INFLIGHT_EVENTS = new Set([
  "UserPromptSubmit",
  "UserPromptExpansion",
  "MessageDisplay",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
]);
const IDLE_EVENTS = new Set(["Stop", "StopFailure", "SessionEnd"]);
const NON_ACTIVITY_EVENTS = new Set([
  "Setup",
  "SessionStart",
  "Notification",
  "TeammateIdle",
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "InstructionsLoaded",
  "PreCompact",
  "PostCompact",
  ...IDLE_EVENTS,
]);
const ERROR_EVENTS = new Set(["PostToolUseFailure", "StopFailure"]);
const GRAPH_EVENT_TYPES = new Set([
  "UserPromptSubmit",
  "MessageDisplay",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "SessionEnd",
  "Elicitation",
  "ElicitationResult",
]);

export interface StoredClaudeEvent {
  version: typeof CLAUDE_EVENT_LOG_VERSION;
  type: string;
  sessionId: string;
  timestamp: number;
  cwdKey?: string;
  notificationType?: string;
  toolName?: string;
  agentType?: string;
  final?: boolean;
}

export type ClaudeStateMap = Map<string, ClaudeSessionState>;

export function boundedClaudeLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_METADATA_LABEL_LENGTH) : undefined;
}

export function normalizeClaudeEventType(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const key = trimmed.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return CANONICAL_TYPES[key] ?? trimmed;
}

export function stableClaudePathKey(value: string | undefined): string | undefined {
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 24)
    : undefined;
}

function isActivityEvent(type: string): boolean {
  return !!type && !NON_ACTIVITY_EVENTS.has(type);
}

function shouldRetainGraphEvent(event: ClaudeEvent, type: string): boolean {
  if (!GRAPH_EVENT_TYPES.has(type)) return false;
  return type !== "MessageDisplay" || event.final !== false;
}

export function shouldPersistClaudeEvent(event: ClaudeEvent, type: string): boolean {
  if (shouldRetainGraphEvent(event, type)) return true;
  if (type === "SessionStart" || type === "CwdChanged") return true;
  return (
    type === "Notification" &&
    event.notificationType?.trim().toLowerCase() === "idle_prompt"
  );
}

function summarizeClaudeEvent(event: ClaudeEvent, type: string): EventSummary {
  let summary = `event: ${type}`;
  if (type === "UserPromptSubmit" || type === "UserPromptExpansion") {
    summary = "prompt";
  } else if (type === "MessageDisplay") {
    summary = "message";
  } else if (type === "SubagentStart" || type === "SubagentStop") {
    const agentType = boundedClaudeLabel(event.agentType);
    summary = agentType ? `tool: subagent ${agentType}` : "tool: subagent";
  } else if (type === "TaskCreated" || type === "TaskCompleted") {
    summary = "tool: task";
  } else if (type === "Elicitation" || type === "ElicitationResult") {
    summary = "tool: elicitation";
  } else if (
    type === "PreToolUse" ||
    type === "PostToolUse" ||
    type === "PostToolUseFailure" ||
    type === "PostToolBatch" ||
    type === "PermissionRequest" ||
    type === "PermissionDenied"
  ) {
    summary = `tool: ${boundedClaudeLabel(event.toolName) || type}`;
  }

  return {
    ts: event.timestamp,
    type,
    summary,
    ...(ERROR_EVENTS.has(type) ? { isError: true } : {}),
  };
}

function updateSummary(
  previous: WorkSummary,
  entry: EventSummary,
  activity: boolean
): WorkSummary {
  const summary = { ...previous };
  if (entry.summary === "prompt") summary.lastPrompt = entry.summary;
  if (entry.summary === "message") summary.lastMessage = entry.summary;
  if (entry.summary.startsWith("tool:")) summary.lastTool = entry.summary;
  if (activity && !entry.summary.startsWith("event:")) {
    summary.current = entry.summary;
  }
  return summary;
}

export function expireClaudeInFlight(
  state: ClaudeSessionState,
  now: number
): ClaudeSessionState {
  if (!state.inFlight) return state;
  const lastSignal = state.lastActivityAt ?? state.lastSeenAt;
  return typeof lastSignal === "number" && now - lastSignal > INFLIGHT_TIMEOUT_MS
    ? { ...state, inFlight: false }
    : state;
}

export function pruneClaudeState(map: ClaudeStateMap, now: number): ClaudeStateMap {
  let changed = false;
  const next = new Map<string, ClaudeSessionState>();
  for (const [sessionId, state] of map.entries()) {
    if (now - state.lastSeenAt > CLAUDE_STALE_TTL_MS) {
      changed = true;
      continue;
    }
    const updated = expireClaudeInFlight(state, now);
    if (updated !== state) changed = true;
    next.set(sessionId, updated);
  }
  return changed ? next : map;
}

export function applyClaudeEvent(
  map: ClaudeStateMap,
  event: ClaudeEvent,
  storedCwdKey?: string
): ClaudeStateMap {
  const now = typeof event.timestamp === "number" ? event.timestamp : Date.now();
  const type = normalizeClaudeEventType(event.type);
  const isIdleNotification =
    type === "Notification" &&
    event.notificationType?.trim().toLowerCase() === "idle_prompt";
  const previous = map.get(event.sessionId);
  const entry = summarizeClaudeEvent(event, type);
  const activity = isActivityEvent(type);
  const retain = shouldRetainGraphEvent(event, type);
  const events = retain
    ? [...(previous?.events ?? []), entry].slice(-MAX_EVENTS)
    : previous?.events ?? [];
  const next: ClaudeSessionState = {
    sessionId: event.sessionId,
    inFlight: previous?.inFlight ?? false,
    lastSeenAt: now,
    lastEventAt: now,
    cwd: event.cwd ?? previous?.cwd,
    cwdKey: stableClaudePathKey(event.cwd) ?? storedCwdKey ?? previous?.cwdKey,
    transcriptPath: event.transcriptPath ?? previous?.transcriptPath,
    lastEvent: type,
    lastActivityAt: previous?.lastActivityAt,
    events,
    summary: updateSummary(previous?.summary ?? {}, entry, activity),
    hasError: entry.isError ? true : activity ? false : previous?.hasError,
  };

  if (INFLIGHT_EVENTS.has(type)) next.inFlight = true;
  if (IDLE_EVENTS.has(type) || isIdleNotification) {
    next.inFlight = false;
    next.lastActivityAt = undefined;
  } else if (activity) {
    next.lastActivityAt = now;
  }

  const nextMap = new Map(map);
  nextMap.set(event.sessionId, next);
  return nextMap;
}

export function toStoredClaudeEvent(
  event: ClaudeEvent
): StoredClaudeEvent | undefined {
  const type = normalizeClaudeEventType(event.type);
  if (!shouldPersistClaudeEvent(event, type)) return undefined;
  return {
    version: CLAUDE_EVENT_LOG_VERSION,
    type,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    cwdKey: stableClaudePathKey(event.cwd),
    notificationType: boundedClaudeLabel(event.notificationType),
    toolName: boundedClaudeLabel(event.toolName),
    agentType: boundedClaudeLabel(event.agentType),
    final: event.final,
  };
}

export function storedClaudeEventKey(event: StoredClaudeEvent): string {
  return [
    event.version,
    event.sessionId,
    event.timestamp,
    event.type,
    event.cwdKey ?? "",
    event.notificationType ?? "",
    event.toolName ?? "",
    event.agentType ?? "",
    event.final === undefined ? "" : String(event.final),
  ].join("\0");
}

export function isStoredClaudeEvent(value: unknown): value is StoredClaudeEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event.version === CLAUDE_EVENT_LOG_VERSION &&
    typeof event.type === "string" &&
    typeof event.sessionId === "string" &&
    typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp) &&
    (event.cwdKey === undefined || typeof event.cwdKey === "string") &&
    (event.notificationType === undefined ||
      typeof event.notificationType === "string") &&
    (event.toolName === undefined || typeof event.toolName === "string") &&
    (event.agentType === undefined || typeof event.agentType === "string") &&
    (event.final === undefined || typeof event.final === "boolean")
  );
}

export function fromStoredClaudeEvent(event: StoredClaudeEvent): ClaudeEvent {
  return {
    type: event.type,
    sessionId: event.sessionId,
    notificationType: boundedClaudeLabel(event.notificationType),
    toolName: boundedClaudeLabel(event.toolName),
    agentType: boundedClaudeLabel(event.agentType),
    final: event.final,
    timestamp: event.timestamp,
  } as ClaudeEvent;
}
