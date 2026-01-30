import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

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
    if (req.url === "/api/claude-event" && req.method === "POST") {
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

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port, received };
}

test("claude hook forwards payload to consensus endpoint", async () => {
  const { server, port, received } = await startServer();
  const script = path.join(process.cwd(), "src", "claudeHook.ts");
  const endpoint = `http://127.0.0.1:${port}/api/claude-event`;
  const payload = {
    hook_event_name: "UserPromptSubmit",
    session_id: "ses_test",
    cwd: "/tmp/claude",
    transcript_path: "/tmp/claude.jsonl",
  };

  const child = spawn(process.execPath, ["--import", "tsx", script, endpoint], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.stdin?.write(JSON.stringify(payload));
  child.stdin?.end();

  try {
    const body = await Promise.race([
      received,
      new Promise<Record<string, unknown>>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000)
      ),
    ]);
    assert.equal(body.type, "UserPromptSubmit");
    assert.equal(body.sessionId, "ses_test");
    assert.equal(body.cwd, "/tmp/claude");
    assert.equal(body.transcriptPath, "/tmp/claude.jsonl");
    assert.equal(typeof body.timestamp, "number");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!child.killed) child.kill();
  }
});
