import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Effect } from "effect";
import { runCodexNotify } from "../../src/codexNotify.ts";

async function startServer(): Promise<{
  server: http.Server;
  port: number;
  received: Promise<Record<string, unknown>>;
}> {
  let resolveBody: (value: Record<string, unknown>) => void;
  const received = new Promise<Record<string, unknown>>((resolve) => {
    resolveBody = resolve;
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/api/codex-event" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(text);
          resolveBody(parsed as Record<string, unknown>);
        } catch {
          resolveBody({ parseError: true });
        }
        res.statusCode = 200;
        res.end("ok");
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port, received };
}

test("codex notify forwards payload to endpoint", async (t) => {
  let started: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    started = await startServer();
  } catch (err: any) {
    if (err?.code === "EPERM") {
      t.skip("Sandbox blocks listen(127.0.0.1) for integration tests");
      return;
    }
    throw err;
  }
  const { server, port, received } = started;
  const endpoint = `http://127.0.0.1:${port}/api/codex-event`;
  const payload = {
    type: "turn.started",
    "thread-id": "thread-xyz",
    "turn-id": "turn-1",
  };

  try {
    await Effect.runPromise(
      runCodexNotify(["node", "codexNotify", endpoint], {
        readStdin: async () => JSON.stringify(payload),
      })
    );

    const body = await Promise.race([
      received,
      new Promise<Record<string, unknown>>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000)
      ),
    ]);

    assert.equal(body.type, "turn.started");
    assert.equal(body.threadId, "thread-xyz");
    assert.equal(body.turnId, "turn-1");
    assert.equal(typeof body.timestamp, "number");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("codex notify forwards argv payload to endpoint", async (t) => {
  let started: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    started = await startServer();
  } catch (err: any) {
    if (err?.code === "EPERM") {
      t.skip("Sandbox blocks listen(127.0.0.1) for integration tests");
      return;
    }
    throw err;
  }
  const { server, port, received } = started;
  const endpoint = `http://127.0.0.1:${port}/api/codex-event`;
  const payload = {
    type: "turn.started",
    "thread-id": "thread-argv",
    "turn-id": "turn-2",
  };
  const argvPayload = JSON.stringify(payload);

  try {
    await Effect.runPromise(
      runCodexNotify(["node", "codexNotify", endpoint, argvPayload], {
        readStdin: async () => "",
      })
    );

    const body = await Promise.race([
      received,
      new Promise<Record<string, unknown>>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000)
      ),
    ]);

    assert.equal(body.type, "turn.started");
    assert.equal(body.threadId, "thread-argv");
    assert.equal(body.turnId, "turn-2");
    assert.equal(typeof body.timestamp, "number");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
