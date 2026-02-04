#!/usr/bin/env node
import { Effect, pipe } from "effect";

type RawPayload = Record<string, unknown>;

type NormalizedEvent = {
  type: string;
  sessionId: string;
  cwd?: string;
  transcriptPath?: string;
  notificationType?: string;
  timestamp: number;
};

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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
  const cwd = readString(payload.cwd);
  const transcriptPath = readString(payload.transcript_path) || readString(payload.transcriptPath);
  const notificationType =
    readString(payload.notification_type) || readString(payload.notificationType);

  return {
    type: hookEvent,
    sessionId,
    cwd,
    transcriptPath,
    notificationType,
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
          {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };
            const token = (process.env.CONSENSUS_API_TOKEN || "").trim();
            if (token) headers.Authorization = `Bearer ${token}`;
            return fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify(event),
            });
          }
        ).pipe(Effect.as(null));
      })
    );
  }),
  Effect.catchAll(() => Effect.succeed(null))
);

void Effect.runPromise(program);
