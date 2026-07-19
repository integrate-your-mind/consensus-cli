#!/usr/bin/env node
import http from "node:http";

function parseArgs(argv) {
  const args = {
    port: 8799,
    mode: "clean",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const next = argv[i + 1];
    if (!next || next.startsWith("-")) continue;
    if (raw === "--port") {
      args.port = Number(next);
      i += 1;
      continue;
    }
    if (raw === "--mode") {
      args.mode = String(next);
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) args.port = 8799;
  if (args.mode !== "clean" && args.mode !== "flicker") args.mode = "clean";
  return args;
}

function buildAgents(mode, elapsedMs) {
  const base = (identity, state) => ({
    id: identity,
    identity,
    kind: "tui",
    cpu: 0,
    mem: 0,
    state,
  });

  if (mode === "flicker") {
    const aState = elapsedMs < 1000 ? "active" : elapsedMs < 2000 ? "idle" : "active";
    return [base("mock:a", aState), base("mock:b", "idle"), base("mock:c", "idle")];
  }

  const t = elapsedMs;
  let a = "idle";
  let b = "idle";
  let c = "idle";
  if (t < 5000) {
    a = "active";
  } else if (t < 16000) {
    b = "active";
  } else if (t < 22000) {
    a = "active";
    c = "active";
  }
  return [base("mock:a", a), base("mock:b", b), base("mock:c", c)];
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  let pathname = url;
  try {
    pathname = new URL(url, "http://127.0.0.1").pathname;
  } catch {
    pathname = url.split("?")[0] || "/";
  }
  if (pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/api/snapshot") {
    const now = Date.now();
    json(res, 200, {
      ts: now,
      agents: buildAgents(args.mode, now - startedAt),
    });
    return;
  }
  json(res, 404, { error: "not_found" });
});

server.listen(args.port, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : args.port;
  process.stdout.write(
    `mock-snapshot-server mode=${args.mode} listening http://127.0.0.1:${port}\n`
  );
});
