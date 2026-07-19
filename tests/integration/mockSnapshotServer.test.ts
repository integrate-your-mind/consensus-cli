import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || !addr) {
        server.close(() => reject(new Error("Failed to allocate port")));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  pattern: RegExp,
  timeoutMs = 5000
): Promise<void> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      const text = Buffer.concat(chunks).toString("utf8");
      cleanup(() =>
        reject(new Error(`Timed out waiting for output: ${pattern}\n${text}`))
      );
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      if (pattern.test(text)) cleanup(resolve);
    };
    const onExit = (code: number | null) => {
      cleanup(() =>
        reject(new Error(`mock-snapshot-server exited early code=${code ?? 0}`))
      );
    };
    const cleanup = (done: () => void) => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
      done();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

test("mock snapshot server accepts query params on /api/snapshot", async (t) => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "../..");
  const scriptPath = path.join(repoRoot, "scripts", "mock-snapshot-server.js");
  const port = await getFreePort();

  const child = spawn(
    process.execPath,
    [scriptPath, "--port", String(port), "--mode", "clean"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    }
  ) as ChildProcessWithoutNullStreams;

  t.after(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  });

  await waitForOutput(child, /mock-snapshot-server .* listening/i);

  const response = await fetch(`http://127.0.0.1:${port}/api/snapshot?cached=1`);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { ts?: unknown; agents?: unknown };
  assert.equal(typeof payload.ts, "number");
  assert.ok(Array.isArray(payload.agents));
});
