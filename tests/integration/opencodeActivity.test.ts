import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getOpenCodeSessionActivity } from "../../src/opencodeApi.js";
import { deriveOpenCodeState } from "../../src/opencodeState.ts";

const originalStale = process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS;
process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS = "0";

// Helper to create a mock HTTP server that returns specified messages
function createMockServer(
  responseData: unknown,
  statusCode = 200,
  contentType = "application/json"
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(statusCode, { "Content-Type": contentType });
      res.end(JSON.stringify(responseData));
    });
    const onError = (err: unknown) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function createMockServerOrSkip(
  t: any,
  responseData: unknown,
  statusCode = 200,
  contentType = "application/json"
): Promise<{ server: http.Server; port: number; close: () => Promise<void> } | null> {
  try {
    return await createMockServer(responseData, statusCode, contentType);
  } catch (err: any) {
    if (err?.code === "EPERM") {
      t.skip("Sandbox blocks listen(127.0.0.1) for integration tests");
      return null;
    }
    throw err;
  }
}

test("getOpenCodeSessionActivity returns inFlight=true for incomplete assistant message", async (t) => {
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: Date.now() },
      },
      parts: [],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true, "Should be in flight for incomplete message");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity returns inFlight=false for completed assistant message", async (t) => {
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: Date.now() - 5000, completed: Date.now() },
      },
      parts: [],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, false, "Should be idle for completed message");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity returns inFlight=true for pending tool call", async (t) => {
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: Date.now() },
      },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: Date.now() - 1000, end: Date.now() - 500 } },
        { id: "prt_2", type: "tool", tool: "apply_patch", state: { status: "pending" } },
      ],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true, "Should be in flight for pending tool");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity returns inFlight=true for running tool call", async (t) => {
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: Date.now() },
      },
      parts: [
        { id: "prt_1", type: "tool", tool: "shell", state: { status: "running" } },
      ],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true, "Should be in flight for running tool");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity returns inFlight=false when all tools completed", async (t) => {
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: Date.now() - 5000, completed: Date.now() },
      },
      parts: [
        { id: "prt_1", type: "tool", tool: "apply_patch", state: { status: "completed" } },
        { id: "prt_2", type: "tool", tool: "shell", state: { status: "completed" } },
      ],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, false, "Should be idle when all tools completed");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity returns inFlight=true for incomplete part (no end time)", async (t) => {
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: Date.now() },
      },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: Date.now() - 1000 } }, // No end
      ],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true, "Should be in flight for incomplete part");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity returns inFlight=false when message completed but parts incomplete", async (t) => {
  const now = Date.now();
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: now - 2000, completed: now - 1000 },
      },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: now - 1500 } },
      ],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, false, "Completed message should end in-flight");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity handles empty messages array", async (t) => {
  const mock = await createMockServerOrSkip(t, []);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, false);
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity handles non-200 response", async (t) => {
  const mock = await createMockServerOrSkip(t, { error: "not found" }, 404);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.inFlight, false);
    assert.equal(result.error, "status_404");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity handles non-JSON response", async (t) => {
  const mock = await createMockServerOrSkip(t, "not json", 200, "text/plain");
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.inFlight, false);
    assert.equal(result.error, "non_json");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity handles connection timeout", async () => {
  // Use a port that nothing is listening on
  const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", 59999, {
    silent: true,
    timeoutMs: 100,
  });
  assert.equal(result.ok, false);
  assert.equal(result.inFlight, false);
});

test("getOpenCodeSessionActivity tracks lastActivityAt correctly", async (t) => {
  const now = Date.now();
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "user",
        time: { created: now - 5000, completed: now - 4999 },
      },
    },
    {
      info: {
        id: "msg_2",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: now - 4000, completed: now - 1000 },
      },
      parts: [
        { id: "prt_1", type: "text", time: { start: now - 3000, end: now - 1000 } },
      ],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.lastActivityAt, now - 1000, "Should track latest activity timestamp");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity detects real-world pending tool scenario", async (t) => {
  // Exact structure from the bug report
  const messages = [
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
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true, "Should detect pending tool from real-world scenario");
  } finally {
    await mock.close();
  }
});

test("message API inFlight stays active even when status is idle", async (t) => {
  const now = Date.now();
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: now },
      },
      parts: [],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const activity = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(activity.ok, true);
    assert.equal(activity.inFlight, true);

    const state = deriveOpenCodeState({
      hasError: false,
      status: "idle",
      inFlight: activity.inFlight,
      lastActivityAt: activity.lastActivityAt,
      now: activity.lastActivityAt ?? now,
      holdMs: 0,
    });
    assert.equal(state.state, "active");
  } finally {
    await mock.close();
  }
});

test("getOpenCodeSessionActivity handles completed message with completed tools", async (t) => {
  const now = Date.now();
  const messages = [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: now - 10000, completed: now - 1000 },
      },
      parts: [
        { id: "prt_1", type: "reasoning", time: { start: now - 9000, end: now - 8000 } },
        { id: "prt_2", type: "tool", tool: "read_file", state: { status: "completed" } },
        { id: "prt_3", type: "tool", tool: "apply_patch", state: { status: "completed" } },
        { id: "prt_4", type: "text", time: { start: now - 3000, end: now - 1000 } },
      ],
    },
  ];
  const mock = await createMockServerOrSkip(t, messages);
  if (!mock) return;
  try {
    const result = await getOpenCodeSessionActivity("ses_test", "127.0.0.1", mock.port, {
      silent: true,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, false, "Should be idle when message and all tools completed");
  } finally {
    await mock.close();
  }
});

process.on("exit", () => {
  if (originalStale === undefined) {
    delete process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS;
  } else {
    process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS = originalStale;
  }
});
