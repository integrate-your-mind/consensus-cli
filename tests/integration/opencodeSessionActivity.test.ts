import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getOpenCodeSessionActivity } from "../../src/opencodeApi.ts";

const originalStale = process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS;
process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS = "0";

type ServerHandle = { server: http.Server; port: number };

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<ServerHandle> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("getOpenCodeSessionActivity detects in-flight assistant message", async () => {
  const { server, port } = await startServer((req, res) => {
    if (req.url === "/session/s1/message") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify([
          { info: { role: "user", time: { created: 1000, completed: 1000 } } },
          { info: { role: "assistant", time: { created: 2000 } } },
        ])
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const result = await getOpenCodeSessionActivity("s1", "127.0.0.1", port, {
      timeoutMs: 2000,
      silent: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true);
    assert.equal(result.lastActivityAt, 2000);
  } finally {
    await closeServer(server);
  }
});

process.on("exit", () => {
  if (originalStale === undefined) {
    delete process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS;
  } else {
    process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS = originalStale;
  }
});

test("getOpenCodeSessionActivity treats pending tool as in-flight", async () => {
  const { server, port } = await startServer((req, res) => {
    if (req.url === "/session/s2/message") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify([
          {
            info: { role: "assistant", time: { created: 2000, completed: 3000 } },
            parts: [{ type: "tool", state: { status: "running" } }],
          },
        ])
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const result = await getOpenCodeSessionActivity("s2", "127.0.0.1", port, {
      timeoutMs: 2000,
      silent: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true);
    assert.equal(result.lastActivityAt, 3000);
  } finally {
    await closeServer(server);
  }
});

test("getOpenCodeSessionActivity treats recent user message as in-flight", async () => {
  const created = Date.now();
  const { server, port } = await startServer((req, res) => {
    if (req.url === "/session/s5/message") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify([
          { info: { role: "user", time: { created, completed: created } } },
        ])
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const result = await getOpenCodeSessionActivity("s5", "127.0.0.1", port, {
      timeoutMs: 2000,
      silent: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true);
    assert.equal(result.lastActivityAt, created);
  } finally {
    await closeServer(server);
  }
});

test("getOpenCodeSessionActivity returns ok false on non-JSON response", async () => {
  const { server, port } = await startServer((req, res) => {
    if (req.url === "/session/s3/message") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("not-json");
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const result = await getOpenCodeSessionActivity("s3", "127.0.0.1", port, {
      timeoutMs: 2000,
      silent: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.inFlight, false);
    assert.equal(result.error, "non_json");
  } finally {
    await closeServer(server);
  }
});

test("getOpenCodeSessionActivity returns ok false on non-200 response", async () => {
  const { server, port } = await startServer((req, res) => {
    if (req.url === "/session/s4/message") {
      res.statusCode = 500;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const result = await getOpenCodeSessionActivity("s4", "127.0.0.1", port, {
      timeoutMs: 2000,
      silent: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.inFlight, false);
    assert.equal(result.error, "status_500");
  } finally {
    await closeServer(server);
  }
});
