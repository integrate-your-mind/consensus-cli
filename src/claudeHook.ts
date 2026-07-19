#!/usr/bin/env node
import { Effect, pipe } from "effect";

type RawPayload = Record<string, unknown>;

type NormalizedEvent = {
  type: string;
  sessionId: string;
  cwd?: string;
  transcriptPath?: string;
  notificationType?: string;
  toolName?: string;
  agentType?: string;
  final?: boolean;
  timestamp: number;
};

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizePayload(payload: RawPayload): NormalizedEvent | null {
  const hookEvent =
    readString(payload.hook_event_name) ||
    readString(payload.hookEventName) ||
    readString(payload.event) ||
    readString(payload.type);
  const sessionId = readString(payload.session_id) || readString(payload.sessionId);
  if (!hookEvent || !sessionId) return null;

  return {
    type: hookEvent,
    sessionId,
    cwd: readString(payload.cwd),
    transcriptPath:
      readString(payload.transcript_path) || readString(payload.transcriptPath),
    notificationType:
      readString(payload.notification_type) || readString(payload.notificationType),
    toolName: readString(payload.tool_name) || readString(payload.toolName),
    agentType: readString(payload.agent_type) || readString(payload.agentType),
    final: readBoolean(payload.final),
    timestamp: Date.now(),
  };
}

const endpoint = process.argv[2];
if (!endpoint) {
  process.exit(0);
}

const program = pipe(
  Effect.promise(readStdin),
  Effect.flatMap((input) => {
    if (!input.trim()) return Effect.succeed(null);
    return Effect.try({
      try: () => JSON.parse(input) as RawPayload,
      catch: () => null,
    }).pipe(
      Effect.flatMap((payload) => {
        if (!payload || typeof payload !== "object") return Effect.succeed(null);
        const event = normalizePayload(payload);
        if (!event) return Effect.succeed(null);
        return Effect.promise(() =>
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
          })
        ).pipe(Effect.as(null));
      })
    );
  }),
  Effect.catchAll(() => Effect.succeed(null))
);

void Effect.runPromise(program);
