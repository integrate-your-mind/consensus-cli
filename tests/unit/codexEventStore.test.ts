import test from "node:test";
import assert from "node:assert/strict";
import { codexEventStore } from "../../src/services/codexEvents.js";
import type { CodexEvent } from "../../src/codex/types.js";

test("event store tracks thread inFlight state", () => {
  const threadId = "thread-abc-123";
  
  // Initial state - no events
  let state = codexEventStore.getThreadState(threadId);
  assert.strictEqual(state, undefined);
  
  // Turn started
  codexEventStore.handleEvent({
    type: "turn.started",
    threadId,
    turnId: "turn-1",
    timestamp: Date.now()
  } as CodexEvent);
  
  state = codexEventStore.getThreadState(threadId);
  assert.ok(state);
  assert.strictEqual(state?.inFlight, true);
  
  // Turn completed
  codexEventStore.handleEvent({
    type: "agent-turn-complete",
    threadId,
    turnId: "turn-1",
    timestamp: Date.now()
  } as CodexEvent);
  
  state = codexEventStore.getThreadState(threadId);
  assert.ok(state);
  assert.strictEqual(state?.inFlight, false);
});

test("event store tracks item-level activity", () => {
  const threadId = "thread-def-456";
  
  // Multiple items started
  codexEventStore.handleEvent({
    type: "item.started",
    threadId,
    turnId: "item-1",
    timestamp: Date.now()
  } as CodexEvent);
  
  codexEventStore.handleEvent({
    type: "item.started",
    threadId,
    turnId: "item-2",
    timestamp: Date.now()
  } as CodexEvent);
  
  let state = codexEventStore.getThreadState(threadId);
  assert.strictEqual(state?.inFlight, true);
  
  // One item completes - still in flight
  codexEventStore.handleEvent({
    type: "item.completed",
    threadId,
    turnId: "item-1",
    timestamp: Date.now()
  } as CodexEvent);
  
  state = codexEventStore.getThreadState(threadId);
  assert.strictEqual(state?.inFlight, true);
  
  // Last item completes - idle
  codexEventStore.handleEvent({
    type: "item.completed",
    threadId,
    turnId: "item-2",
    timestamp: Date.now()
  } as CodexEvent);
  
  state = codexEventStore.getThreadState(threadId);
  assert.strictEqual(state?.inFlight, false);
});

test("event store updates lastActivityAt on every event", () => {
  const threadId = "thread-ghi-789";
  const ts1 = 1000000;
  const ts2 = 2000000;
  
  codexEventStore.handleEvent({
    type: "turn.started",
    threadId,
    turnId: "turn-1",
    timestamp: ts1
  } as CodexEvent);
  
  let state = codexEventStore.getThreadState(threadId);
  assert.strictEqual(state?.lastActivityAt, ts1);
  
  codexEventStore.handleEvent({
    type: "agent-turn-complete",
    threadId,
    turnId: "turn-1",
    timestamp: ts2
  } as CodexEvent);
  
  state = codexEventStore.getThreadState(threadId);
  assert.strictEqual(state?.lastActivityAt, ts2);
});

test("event store handles multiple threads independently", () => {
  const thread1 = "thread-1";
  const thread2 = "thread-2";
  
  codexEventStore.handleEvent({
    type: "turn.started",
    threadId: thread1,
    turnId: "turn-1",
    timestamp: Date.now()
  } as CodexEvent);
  
  codexEventStore.handleEvent({
    type: "agent-turn-complete",
    threadId: thread2,
    turnId: "turn-2",
    timestamp: Date.now()
  } as CodexEvent);
  
  const state1 = codexEventStore.getThreadState(thread1);
  const state2 = codexEventStore.getThreadState(thread2);
  
  assert.strictEqual(state1?.inFlight, true);
  assert.strictEqual(state2?.inFlight, false);
});

test("event store thread isolation", () => {
  const allThreads = codexEventStore.getAllThreads();
  
  // Clear any existing state
  for (const [threadId, state] of allThreads) {
    if (state) {
      codexEventStore.handleEvent({
        type: "agent-turn-complete",
        threadId,
        timestamp: Date.now()
      } as CodexEvent);
    }
  }
  
  const threadA = "isolated-thread-a";
  const threadB = "isolated-thread-b";
  
  codexEventStore.handleEvent({
    type: "turn.started",
    threadId: threadA,
    turnId: "turn-a",
    timestamp: Date.now()
  } as CodexEvent);
  
  const stateA = codexEventStore.getThreadState(threadA);
  const stateB = codexEventStore.getThreadState(threadB);
  
  assert.strictEqual(stateA?.inFlight, true);
  assert.strictEqual(stateB, undefined);
});
