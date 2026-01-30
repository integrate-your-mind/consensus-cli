import test from "node:test";
import assert from "node:assert/strict";
import { extractWebhookEvent, normalizePayload } from "../../src/codexNotify.ts";

test("normalizePayload parses JSON", () => {
  const payload = normalizePayload('{"type":"turn.started","thread-id":"t1"}');
  assert.ok(payload && typeof payload === "object");
});

test("normalizePayload returns null for empty", () => {
  const payload = normalizePayload(" ");
  assert.equal(payload, null);
});

test("extractWebhookEvent reads thread-id and type", () => {
  const payload = {
    type: "turn.started",
    "thread-id": "thread-123",
    "turn-id": "turn-1",
  } as Record<string, unknown>;
  const event = extractWebhookEvent(payload, 1234567890);
  assert.ok(event);
  assert.equal(event?.type, "turn.started");
  assert.equal(event?.threadId, "thread-123");
  assert.equal(event?.turnId, "turn-1");
  assert.equal(event?.timestamp, 1234567890);
});

test("extractWebhookEvent returns null without threadId", () => {
  const payload = { type: "turn.started" } as Record<string, unknown>;
  const event = extractWebhookEvent(payload, 1234567890);
  assert.equal(event, null);
});
