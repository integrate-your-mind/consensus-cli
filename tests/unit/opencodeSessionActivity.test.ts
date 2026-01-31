import test from "node:test";
import assert from "node:assert/strict";

// Test the message activity parsing logic used by getOpenCodeSessionActivity
// These tests validate the core logic that determines if a session is actively generating

interface OpenCodeMessagePart {
  id?: string;
  type?: string;
  tool?: string;
  state?: {
    status?: string;
  };
  time?: {
    start?: number;
    end?: number;
  };
}

interface OpenCodeMessage {
  info?: {
    id?: string;
    sessionID?: string;
    role?: string;
    time?: {
      created?: number;
      completed?: number;
    };
  };
  parts?: OpenCodeMessagePart[];
}

interface ActivityResult {
  inFlight: boolean;
  lastActivityAt?: number;
}

// Mirror the parsing logic from getOpenCodeSessionActivity for testability
function parseMessageActivity(messages: OpenCodeMessage[]): ActivityResult {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { inFlight: false };
  }

  let latestAssistant: OpenCodeMessage | undefined;
  let latestActivityAt: number | undefined;

  for (const msg of messages) {
    const created = msg?.info?.time?.created;
    const completed = msg?.info?.time?.completed;

    if (typeof created === "number") {
      latestActivityAt = latestActivityAt ? Math.max(latestActivityAt, created) : created;
    }
    if (typeof completed === "number") {
      latestActivityAt = latestActivityAt ? Math.max(latestActivityAt, completed) : completed;
    }

    if (msg?.info?.role === "assistant") {
      if (!latestAssistant || (created && (!latestAssistant.info?.time?.created || created > latestAssistant.info.time.created))) {
        latestAssistant = msg;
      }
    }
  }

  if (!latestAssistant) {
    return { inFlight: false, lastActivityAt: latestActivityAt };
  }

  // Check if the latest assistant message is incomplete (no completed timestamp)
  const hasCompleted = typeof latestAssistant.info?.time?.completed === "number";

  // Also check for pending/running tool calls in message parts
  let hasPendingTool = false;
  let hasIncompletePart = false;

  if (Array.isArray(latestAssistant.parts)) {
    for (const part of latestAssistant.parts) {
      // Check for pending or running tool
      if (part?.type === "tool") {
        const status = part?.state?.status;
        if (status === "pending" || status === "running") {
          hasPendingTool = true;
        }
      }
      // Check for parts with start but no end time (still in progress)
      if (typeof part?.time?.start === "number" && typeof part?.time?.end !== "number") {
        hasIncompletePart = true;
      }
    }
  }

  // Session is in flight if:
  // 1. Assistant message has no completed timestamp, OR
  // 2. There's a pending/running tool call
  // Incomplete parts only matter when the message is not completed.
  const inFlight = hasPendingTool || !hasCompleted;

  return { inFlight, lastActivityAt: latestActivityAt };
}

// =============================================================================
// Basic Message Activity Tests
// =============================================================================

test("returns inFlight=false for empty messages array", () => {
  const result = parseMessageActivity([]);
  assert.equal(result.inFlight, false);
  assert.equal(result.lastActivityAt, undefined);
});

test("returns inFlight=false when no assistant messages", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "user", time: { created: 1000, completed: 1001 } } },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false);
  assert.equal(result.lastActivityAt, 1001);
});

test("returns inFlight=true when latest assistant message has no completed timestamp", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "user", time: { created: 1000, completed: 1001 } } },
    { info: { id: "msg_2", role: "assistant", time: { created: 2000 } } },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true);
  assert.equal(result.lastActivityAt, 2000);
});

test("returns inFlight=false when latest assistant message is completed", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "user", time: { created: 1000, completed: 1001 } } },
    { info: { id: "msg_2", role: "assistant", time: { created: 2000, completed: 3000 } } },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false);
  assert.equal(result.lastActivityAt, 3000);
});

test("finds latest assistant message by created timestamp", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "assistant", time: { created: 1000, completed: 1500 } } },
    { info: { id: "msg_2", role: "user", time: { created: 2000, completed: 2001 } } },
    { info: { id: "msg_3", role: "assistant", time: { created: 3000 } } },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true);
  assert.equal(result.lastActivityAt, 3000);
});

test("returns inFlight=false when older incomplete assistant exists but latest is complete", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "assistant", time: { created: 1000 } } },
    { info: { id: "msg_2", role: "assistant", time: { created: 3000, completed: 4000 } } },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false);
  assert.equal(result.lastActivityAt, 4000);
});

test("handles messages with missing info gracefully", () => {
  const messages: OpenCodeMessage[] = [
    {},
    { info: {} },
    { info: { role: "assistant" } },
    { info: { id: "msg_1", role: "assistant", time: { created: 1000, completed: 2000 } } },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false);
  assert.equal(result.lastActivityAt, 2000);
});

test("tracks lastActivityAt across all message timestamps", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "user", time: { created: 1000, completed: 1001 } } },
    { info: { id: "msg_2", role: "assistant", time: { created: 2000, completed: 5000 } } },
    { info: { id: "msg_3", role: "user", time: { created: 6000, completed: 6001 } } },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.lastActivityAt, 6001);
});

// =============================================================================
// Pending Tool Detection Tests (Critical for flicker fix)
// =============================================================================

test("returns inFlight=true when assistant message has pending tool call", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "user", time: { created: 1000, completed: 1001 } } },
    {
      info: { id: "msg_2", role: "assistant", time: { created: 2000 } },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: 2001, end: 2500 } },
        { id: "prt_2", type: "tool", tool: "apply_patch", state: { status: "pending" } },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true, "Should be in flight due to pending tool");
});

test("returns inFlight=true when assistant message has running tool call", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "user", time: { created: 1000, completed: 1001 } } },
    {
      info: { id: "msg_2", role: "assistant", time: { created: 2000 } },
      parts: [
        { id: "prt_1", type: "tool", tool: "shell", state: { status: "running" } },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true, "Should be in flight due to running tool");
});

test("returns inFlight=false when all tools are completed", () => {
  const messages: OpenCodeMessage[] = [
    { info: { id: "msg_1", role: "user", time: { created: 1000, completed: 1001 } } },
    {
      info: { id: "msg_2", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [
        { id: "prt_1", type: "tool", tool: "apply_patch", state: { status: "completed" } },
        { id: "prt_2", type: "tool", tool: "shell", state: { status: "completed" } },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false, "Should be idle when all tools completed");
});

test("returns inFlight=true when message is completed but has pending tool (edge case)", () => {
  // This tests a potential race condition where time.completed is set but tool is still pending
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [
        { id: "prt_1", type: "tool", tool: "apply_patch", state: { status: "pending" } },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true, "Pending tool should override completed timestamp");
});

// =============================================================================
// Incomplete Part Detection Tests
// =============================================================================

test("returns inFlight=true when part has start but no end time", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000 } },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: 2001 } }, // No end = still in progress
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true, "Should be in flight due to incomplete part");
});

test("returns inFlight=false when message completed but parts lack end", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: 2001 } },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false, "Completed message should end in-flight");
});

test("returns inFlight=false when all parts have end times", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: 2001, end: 2500 } },
        { id: "prt_2", type: "text", time: { start: 2501, end: 3000 } },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false, "Should be idle when all parts completed");
});

test("returns inFlight=false when message completed but part still in progress", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: 2001, end: 2500 } },
        { id: "prt_2", type: "text", time: { start: 2501 } }, // No end
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false, "Completed message should end in-flight");
});

// =============================================================================
// Real-World OpenCode API Response Tests
// =============================================================================

test("detects active generation from real OpenCode message format", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: {
        id: "msg_c0b53f3e5001GpcFbM39JlIPEh",
        sessionID: "ses_3f4ac0c1bffeaupCgsR635QaDg",
        role: "user",
        time: { created: 1769716577345, completed: 1769716577345 },
      },
    },
    {
      info: {
        id: "msg_c0b552cc1001kHc4r3lpbZu370",
        sessionID: "ses_3f4ac0c1bffeaupCgsR635QaDg",
        role: "assistant",
        time: { created: 1769716657345 },
      },
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true);
  assert.equal(result.lastActivityAt, 1769716657345);
});

test("detects completed generation from real OpenCode message format", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: {
        id: "msg_c0b53f3e5001GpcFbM39JlIPEh",
        sessionID: "ses_3f4ac0c1bffeaupCgsR635QaDg",
        role: "user",
        time: { created: 1769716577345, completed: 1769716577345 },
      },
    },
    {
      info: {
        id: "msg_c0b552cc1001kHc4r3lpbZu370",
        sessionID: "ses_3f4ac0c1bffeaupCgsR635QaDg",
        role: "assistant",
        time: { created: 1769716657345, completed: 1769716717749 },
      },
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false);
  assert.equal(result.lastActivityAt, 1769716717749);
});

test("detects pending tool from real OpenCode API response", () => {
  // This is the exact structure that was causing the flicker bug
  const messages: OpenCodeMessage[] = [
    {
      info: {
        id: "msg_c0bc650b9002XNr29VqrWl3en0",
        sessionID: "ses_3f86cd17bffeCOmkq6GLvI1PFw",
        role: "assistant",
        time: { created: 1769724072121 },
      },
      parts: [
        {
          id: "prt_c0bc65947001ko3VOeyOI9HnD4",
          type: "step-start",
        },
        {
          id: "prt_c0bc661cf001or3IxmPyN14ZsD",
          type: "reasoning",
          time: { start: 1769724076495, end: 1769724130661 },
        },
        {
          id: "prt_c0bc73566001MAGJ6RtBusZqPp",
          type: "reasoning",
          time: { start: 1769724130662, end: 1769724132361 },
        },
        {
          id: "prt_c0bc73c0a001TQ370OVK9tRfkK",
          type: "tool",
          tool: "apply_patch",
          state: { status: "pending" },
        },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true, "Should detect pending tool from real API response");
});

test("detects completed tool from real OpenCode API response", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: {
        id: "msg_c0bc650b9002XNr29VqrWl3en0",
        sessionID: "ses_3f86cd17bffeCOmkq6GLvI1PFw",
        role: "assistant",
        time: { created: 1769724072121, completed: 1769724200000 },
      },
      parts: [
        {
          id: "prt_c0bc65947001ko3VOeyOI9HnD4",
          type: "step-start",
        },
        {
          id: "prt_c0bc661cf001or3IxmPyN14ZsD",
          type: "reasoning",
          time: { start: 1769724076495, end: 1769724130661 },
        },
        {
          id: "prt_c0bc73c0a001TQ370OVK9tRfkK",
          type: "tool",
          tool: "apply_patch",
          state: { status: "completed" },
        },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false, "Should detect completed tool from real API response");
});

// =============================================================================
// Multiple Active Indicators Tests
// =============================================================================

test("returns inFlight=true when multiple activity indicators are present", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000 } }, // No completed
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: 2001 } }, // No end
        { id: "prt_2", type: "tool", state: { status: "pending" } }, // Pending tool
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, true);
});

test("handles empty parts array gracefully", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false);
});

test("handles undefined parts gracefully", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false);
});

test("tool with error status is not considered in flight", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [
        { id: "prt_1", type: "tool", state: { status: "error" } },
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false, "Error status should not be considered in flight");
});

test("part without time object is not considered incomplete", () => {
  const messages: OpenCodeMessage[] = [
    {
      info: { id: "msg_1", role: "assistant", time: { created: 2000, completed: 3000 } },
      parts: [
        { id: "prt_1", type: "step-start" }, // No time object
        { id: "prt_2", type: "text" }, // No time object
      ],
    },
  ];
  const result = parseMessageActivity(messages);
  assert.equal(result.inFlight, false, "Parts without time object should not trigger in flight");
});
