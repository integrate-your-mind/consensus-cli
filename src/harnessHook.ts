#!/usr/bin/env node
import {
  isHookHarnessId,
  normalizeHarnessHookPayload,
} from "./harnessHookModel.js";
import {
  flushHarnessEventPersistence,
  queueHarnessEventPersistence,
} from "./services/harnessEventLog.js";

const MAX_HOOK_INPUT_BYTES = 1024 * 1024;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_HOOK_INPUT_BYTES) return "";
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function main(): Promise<void> {
  const harnessId = process.argv[2];
  if (!isHookHarnessId(harnessId)) return;
  const input = await readStdin();
  if (!input.trim()) return;

  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }

  const event = normalizeHarnessHookPayload(harnessId, payload);
  if (!event) return;
  await queueHarnessEventPersistence(event);
  await flushHarnessEventPersistence();
}

void main().catch(() => undefined);
