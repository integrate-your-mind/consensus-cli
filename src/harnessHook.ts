#!/usr/bin/env node
import {
  isHookHarnessId,
  normalizeHarnessHookPayload,
} from "./harnessHookModel.js";
import { harnessHookAcknowledgement } from "./harnessHookOutput.js";
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

  try {
    const input = await readStdin();
    if (input.trim()) {
      let payload: unknown;
      try {
        payload = JSON.parse(input);
      } catch {
        payload = undefined;
      }
      const event = normalizeHarnessHookPayload(
        harnessId,
        payload,
        Date.now()
      );
      if (event) {
        await queueHarnessEventPersistence(event);
        await flushHarnessEventPersistence();
      }
    }
  } catch {
    // Hooks must never block or fail the owning harness.
  } finally {
    const acknowledgement = harnessHookAcknowledgement(harnessId);
    if (acknowledgement) process.stdout.write(acknowledgement);
  }
}

void main();
