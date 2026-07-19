import { createHash } from "node:crypto";
import type { HarnessId } from "./harnesses.js";
import type { EventSummary } from "./types.js";

export const hookHarnessIds = [
  "claude",
  "hermes",
  "kimi",
  "factory",
  "qwen",
] as const satisfies readonly HarnessId[];

export type HookHarnessId = (typeof hookHarnessIds)[number];
export type CanonicalHarnessHookType =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "UserPromptExpansion"
  | "MessageDisplay"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PostToolBatch"
  | "PermissionRequest"
  | "PermissionResult"
  | "PermissionDenied"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCreated"
  | "TaskCompleted"
  | "PreVerify"
  | "Stop"
  | "StopFailure"
  | "Interrupt"
  | "PreCompact"
  | "PostCompact"
  | "Notification";

export interface NormalizedHarnessHookEvent {
  version: 1;
  harnessId: HookHarnessId;
  type: CanonicalHarnessHookType;
  sessionKey: string;
  timestamp: number;
  cwdKey?: string;
  turnKey?: string;
  toolName?: string;
  agentType?: string;
  notificationType?: string;
  final?: boolean;
}

const MAX_LABEL_LENGTH = 160;
const MAX_IDENTIFIER_LENGTH = 512;
const SAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const DIRECT_TYPES = new Map<string, CanonicalHarnessHookType>([
  ["sessionstart", "SessionStart"],
  ["sessionend", "SessionEnd"],
  ["userpromptsubmit", "UserPromptSubmit"],
  ["userpromptexpansion", "UserPromptExpansion"],
  ["messagedisplay", "MessageDisplay"],
  ["pretooluse", "PreToolUse"],
  ["posttooluse", "PostToolUse"],
  ["posttoolusefailure", "PostToolUseFailure"],
  ["posttoolbatch", "PostToolBatch"],
  ["permissionrequest", "PermissionRequest"],
  ["permissionresult", "PermissionResult"],
  ["permissiondenied", "PermissionDenied"],
  ["subagentstart", "SubagentStart"],
  ["subagentstop", "SubagentStop"],
  ["taskcreated", "TaskCreated"],
  ["taskcompleted", "TaskCompleted"],
  ["stop", "Stop"],
  ["stopfailure", "StopFailure"],
  ["interrupt", "Interrupt"],
  ["precompact", "PreCompact"],
  ["postcompact", "PostCompact"],
  ["notification", "Notification"],
]);
const HERMES_TYPES = new Map<string, CanonicalHarnessHookType>([
  ["pretoolcall", "PreToolUse"],
  ["posttoolcall", "PostToolUse"],
  ["prellmcall", "UserPromptSubmit"],
  ["postllmcall", "Stop"],
  ["preverify", "PreVerify"],
  ["onsessionstart", "SessionStart"],
  ["onsessionend", "SessionEnd"],
  ["onsessionfinalize", "SessionEnd"],
  ["onsessionreset", "SessionEnd"],
  ["subagentstart", "SubagentStart"],
  ["subagentstop", "SubagentStop"],
  ["agentstart", "UserPromptSubmit"],
  ["agentend", "Stop"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function safeText(value: unknown, maxLength = MAX_LABEL_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(SAFE_TEXT_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return normalized || undefined;
}

function identifier(value: unknown): string | undefined {
  return safeText(value, MAX_IDENTIFIER_LENGTH);
}

function firstString(
  payload: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = identifier(payload[key]);
    if (value) return value;
  }
  return undefined;
}

function firstLabel(
  payload: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = safeText(payload[key]);
    if (value) return value;
  }
  return undefined;
}

function nestedLabel(
  payload: Record<string, unknown>,
  containerKey: string,
  keys: readonly string[]
): string | undefined {
  const container = payload[containerKey];
  if (!isRecord(container)) return undefined;
  return firstLabel(container, keys);
}

function parseTimestamp(value: unknown, receivedAt: number): number | undefined {
  let parsed: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    parsed = value < 100_000_000_000 ? value * 1000 : value;
  } else if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== "") {
      parsed = asNumber < 100_000_000_000 ? asNumber * 1000 : asNumber;
    } else {
      const asDate = Date.parse(value);
      if (!Number.isNaN(asDate)) parsed = asDate;
    }
  }
  const fallback = Number.isFinite(receivedAt) && receivedAt >= 0 ? receivedAt : Date.now();
  if (parsed === undefined) return fallback;
  return parsed >= 0 ? parsed : undefined;
}

function opaqueKey(scope: string, value: string): string {
  return createHash("sha256")
    .update(scope)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

function canonicalType(
  harnessId: HookHarnessId,
  rawType: string
): CanonicalHarnessHookType | undefined {
  const compact = compactName(rawType);
  if (harnessId === "hermes") return HERMES_TYPES.get(compact);
  return DIRECT_TYPES.get(compact);
}

function extractRawType(payload: Record<string, unknown>): string | undefined {
  return firstString(payload, [
    "hook_event_name",
    "hookEventName",
    "event_name",
    "eventName",
    "event",
    "type",
  ]);
}

function extractSessionId(
  harnessId: HookHarnessId,
  payload: Record<string, unknown>
): string | undefined {
  const direct = firstString(payload, [
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
  ]);
  if (direct) return direct;
  if (harnessId !== "hermes") return undefined;
  return firstString(payload, ["task_id", "taskId"]);
}

function extractTurnId(payload: Record<string, unknown>): string | undefined {
  const direct = firstString(payload, [
    "turn_id",
    "turnId",
    "api_request_id",
    "apiRequestId",
  ]);
  if (direct) return direct;
  const extra = payload.extra;
  if (!isRecord(extra)) return undefined;
  return firstString(extra, [
    "turn_id",
    "turnId",
    "api_request_id",
    "apiRequestId",
  ]);
}

function extractBoolean(
  payload: Record<string, unknown>,
  keys: readonly string[]
): boolean | undefined {
  for (const key of keys) {
    if (typeof payload[key] === "boolean") return payload[key] as boolean;
  }
  return undefined;
}

export function isHookHarnessId(value: unknown): value is HookHarnessId {
  return (
    typeof value === "string" &&
    (hookHarnessIds as readonly string[]).includes(value)
  );
}

export function normalizeHarnessHookPayload(
  harnessId: HookHarnessId,
  input: unknown,
  receivedAt: number = Date.now()
): NormalizedHarnessHookEvent | undefined {
  if (!isRecord(input)) return undefined;
  const rawType = extractRawType(input);
  const sessionId = extractSessionId(harnessId, input);
  if (!rawType || !sessionId) return undefined;
  const type = canonicalType(harnessId, rawType);
  if (!type) return undefined;
  const timestamp = parseTimestamp(input.timestamp, receivedAt);
  if (timestamp === undefined) return undefined;

  const cwd = firstString(input, ["cwd", "working_directory", "workingDirectory"]);
  const turnId = extractTurnId(input);
  const toolName =
    firstLabel(input, ["tool_name", "toolName", "matcher"]) ??
    nestedLabel(input, "extra", ["tool_name", "toolName"]);
  const agentType =
    firstLabel(input, ["agent_type", "agentType", "subagent_type", "subagentType"]) ??
    nestedLabel(input, "extra", [
      "agent_type",
      "agentType",
      "child_role",
      "childRole",
    ]);
  const notificationType = firstLabel(input, [
    "notification_type",
    "notificationType",
    "reason",
  ]);

  return {
    version: 1,
    harnessId,
    type,
    sessionKey: opaqueKey(`session:${harnessId}`, sessionId),
    timestamp,
    ...(cwd ? { cwdKey: opaqueKey(`cwd:${harnessId}`, cwd) } : {}),
    ...(turnId ? { turnKey: opaqueKey(`turn:${harnessId}`, `${sessionId}\0${turnId}`) } : {}),
    ...(toolName ? { toolName } : {}),
    ...(agentType ? { agentType } : {}),
    ...(notificationType ? { notificationType } : {}),
    ...(() => {
      const final = extractBoolean(input, ["final", "is_final", "isFinal"]);
      return final === undefined ? {} : { final };
    })(),
  };
}

export function harnessHookEventSummary(
  event: NormalizedHarnessHookEvent
): EventSummary | undefined {
  let type: string = event.type;
  let summary = `event: ${event.type}`;
  let isError = false;

  switch (event.type) {
    case "UserPromptSubmit":
      summary = "prompt";
      break;
    case "UserPromptExpansion":
      return undefined;
    case "MessageDisplay":
      if (event.final === false) return undefined;
      summary = "message";
      break;
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolBatch":
    case "PermissionRequest":
    case "PermissionResult":
    case "PermissionDenied":
      summary = `tool: ${event.toolName || event.type}`;
      break;
    case "PostToolUseFailure":
      summary = `tool: ${event.toolName || event.type}`;
      isError = true;
      break;
    case "SubagentStart":
    case "SubagentStop":
      summary = event.agentType
        ? `tool: subagent ${event.agentType}`
        : "tool: subagent";
      break;
    case "TaskCreated":
    case "TaskCompleted":
      summary = "tool: task";
      break;
    case "PreVerify":
      summary = "tool: verify";
      break;
    case "StopFailure":
      type = "turn.failed";
      isError = true;
      break;
    case "Interrupt":
      type = "turn.interrupted";
      break;
    case "Stop":
      type = "turn.completed";
      break;
    case "SessionStart":
      type = "session.started";
      break;
    case "SessionEnd":
      type = "session.ended";
      break;
    case "PreCompact":
    case "PostCompact":
    case "Notification":
      return undefined;
  }

  return {
    ts: event.timestamp,
    type,
    summary,
    ...(isError ? { isError: true } : {}),
    ...(event.turnKey ? { turnId: event.turnKey } : {}),
  };
}

export function harnessHookEventKey(
  event: NormalizedHarnessHookEvent
): string {
  return JSON.stringify([
    event.version,
    event.harnessId,
    event.type,
    event.sessionKey,
    event.timestamp,
    event.cwdKey ?? null,
    event.turnKey ?? null,
    event.toolName ?? null,
    event.agentType ?? null,
    event.notificationType ?? null,
    event.final ?? null,
  ]);
}
