#!/usr/bin/env node
import { Effect } from "effect";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CONSENSUS_CODEX_HOME || env.CODEX_HOME;
  if (!override) return path.join(os.homedir(), ".codex");
  if (override === "~") {
    return os.homedir();
  }
  if (override.startsWith("~/")) {
    return path.join(os.homedir(), override.slice(2));
  }
  return path.resolve(override);
}

const appendNotifyPayload = (payload: NotifyPayload) =>
  Effect.tryPromise({
    try: async () => {
      if (!payload) return;
      const fs = await import("node:fs/promises");
      const codexHome = resolveCodexHome();
      const notifyPath = path.join(codexHome, "consensus", "codex-notify.jsonl");
      await fs.mkdir(path.dirname(notifyPath), { recursive: true });
      await fs.appendFile(notifyPath, `${JSON.stringify(payload)}\n`, "utf8");
    },
    catch: () => undefined,
  });

export type NotifyPayload = Record<string, unknown> | null;

export type CodexWebhookEvent = {
  type: string;
  threadId: string;
  turnId?: string | number;
  timestamp: number;
};

export type NotifyOptions = {
  readStdin?: () => Promise<string>;
  fetchImpl?: typeof fetch;
};

export const normalizePayload = (input: string): NotifyPayload => {
  if (!input.trim()) return null;
  try {
    return JSON.parse(input) as NotifyPayload;
  } catch {
    return null;
  }
};

export const extractWebhookEvent = (
  payload: NotifyPayload,
  now = Date.now()
): CodexWebhookEvent | null => {
  if (!payload || typeof payload !== "object") return null;
  const eventRaw =
    (payload as { [key: string]: unknown }).event ||
    (payload as { [key: string]: unknown }).type ||
    (payload as { [key: string]: unknown })["event-type"];
  const threadRaw =
    (payload as { [key: string]: unknown }).threadId ||
    (payload as { [key: string]: unknown }).thread_id ||
    (payload as { [key: string]: unknown })["thread-id"] ||
    (payload as { thread?: { id?: unknown } }).thread?.id;
  const turnRaw =
    (payload as { [key: string]: unknown }).turnId ||
    (payload as { [key: string]: unknown }).turn_id ||
    (payload as { [key: string]: unknown })["turn-id"] ||
    (payload as { turn?: { id?: unknown; index?: unknown } }).turn?.id ||
    (payload as { turn?: { id?: unknown; index?: unknown } }).turn?.index;

  const type = typeof eventRaw === "string" ? eventRaw : undefined;
  const threadId = typeof threadRaw === "string" ? threadRaw : undefined;
  const turnId =
    typeof turnRaw === "string" || typeof turnRaw === "number" ? turnRaw : undefined;

  if (!type || !threadId) return null;

  return {
    type,
    threadId,
    turnId,
    timestamp: now,
  };
};

const defaultReadStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const postEvent = (
  endpoint: string,
  event: CodexWebhookEvent,
  payload: NotifyPayload,
  fetchImpl: typeof fetch
) =>
  Effect.tryPromise({
    try: () =>
      fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }),
    catch: () => undefined,
  }).pipe(
    Effect.tap(() =>
      process.env.CONSENSUS_CODEX_NOTIFY_DEBUG === "1"
        ? Effect.tryPromise({
            try: async () => {
              const fs = await import("node:fs/promises");
              const os = await import("node:os");
              const path = await import("node:path");
              const debugPath = path.join(
                os.homedir(),
                ".consensus",
                "codex-notify-debug.jsonl"
              );
              await fs.mkdir(path.dirname(debugPath), { recursive: true });
              await fs.appendFile(
                debugPath,
                `${JSON.stringify({ event, payload })}\n`,
                "utf8"
              );
            },
            catch: () => undefined,
          })
        : Effect.void
    )
  );

export const runCodexNotify = (
  args: string[],
  options: NotifyOptions = {}
) => {
  const readStdin = options.readStdin ?? defaultReadStdin;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = args[2];
  const argPayload = args.slice(3).join(" ").trim();

  return Effect.gen(function* () {
    const stdinPayload = argPayload ? "" : yield* Effect.tryPromise({
      try: () => readStdin(),
      catch: () => "",
    });
    const payloadText = argPayload || stdinPayload;
    if (!payloadText) return false;

    const payload = normalizePayload(payloadText);
    if (!payload) return false;

    yield* appendNotifyPayload(payload);

    if (!endpoint) return true;
    const event = extractWebhookEvent(payload);
    if (!event) return true;

    yield* postEvent(endpoint, event, payload, fetchImpl);

    return true;
  });
};

const isMain =
  typeof process !== "undefined" &&
  import.meta.url === pathToFileURL(process.argv[1] || "").href;

if (isMain) {
  Effect.runPromise(runCodexNotify(process.argv)).catch(() => undefined);
}
