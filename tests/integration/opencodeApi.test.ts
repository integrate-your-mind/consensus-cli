import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getOpenCodeSessions } from "../../src/opencodeApi.ts";

async function startServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/session") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([{ id: "ses_1", title: "Test Session" }]));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port };
}

async function startTextServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/session") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("not-json");
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port };
}

test("getOpenCodeSessions returns sessions from API", async () => {
  const { server, port } = await startServer();
  try {
    const result = await getOpenCodeSessions("127.0.0.1", port, { timeoutMs: 2000 });
    assert.equal(result.ok, true);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0]?.id, "ses_1");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("getOpenCodeSessions returns ok false on non-JSON response", async () => {
  const { server, port } = await startTextServer();
  try {
    const result = await getOpenCodeSessions("127.0.0.1", port, {
      timeoutMs: 2000,
      silent: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.sessions.length, 0);
    assert.equal(result.error, "non_json");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
