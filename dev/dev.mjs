#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import process from "process";

const root = process.cwd();
const tscPath = path.join(root, "node_modules", "typescript", "bin", "tsc");
const tsxPkgPath = path.join(root, "node_modules", "tsx", "package.json");
const vitePath = path.join(root, "node_modules", "vite", "bin", "vite.js");
let tsxPath = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
try {
  const tsxPkg = JSON.parse(fs.readFileSync(tsxPkgPath, "utf8"));
  if (typeof tsxPkg.bin === "string") {
    tsxPath = path.join(root, "node_modules", "tsx", tsxPkg.bin);
  }
} catch {
  // Fallback to default tsxPath
}

if (!fs.existsSync(tscPath)) {
  process.stderr.write(`[dev] missing ${tscPath}\n`);
  process.exit(1);
}
if (!fs.existsSync(tsxPath)) {
  process.stderr.write(`[dev] missing ${tsxPath}\n`);
  process.exit(1);
}
if (!fs.existsSync(vitePath)) {
  process.stderr.write(`[dev] missing ${vitePath}\n`);
  process.exit(1);
}

const children = [];

const spawnChild = (label, args) => {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code !== null) {
      process.stderr.write(`[dev] ${label} exited with ${code}\n`);
    }
  });
  children.push(child);
  return child;
};

const tsc = spawnChild("tsc", [
  tscPath,
  "-w",
  "--project",
  "tsconfig.json",
  "--pretty",
  "false",
]);

const parsePort = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0 || num > 65535) return null;
  return Math.floor(num);
};

const basePort =
  parsePort(process.env.CONSENSUS_UI_PORT) ??
  parsePort(process.env.VITE_PORT) ??
  5173;

const baseServerPort = parsePort(process.env.CONSENSUS_PORT) ?? 8787;

const startServer = async () => {
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = baseServerPort + attempt;
    process.stderr.write(`[dev] starting server on port ${port}\n`);

    const child = spawn(
      process.execPath,
      [tsxPath, "watch", "src/server.ts"],
      {
        env: { ...process.env, CONSENSUS_PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let output = "";
    let running = false;
    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("exit", (code) => {
      if (running) {
        process.stderr.write(`[dev] server exited with ${code ?? 0}\n`);
        shutdown(code ?? 1);
      }
    });

    const result = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        running = true;
        children.push(child);
        resolve({ status: "running" });
      }, 1500);

      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const conflict = /EADDRINUSE|address already in use|port .* in use/i.test(
          output
        );
        resolve({ status: conflict ? "conflict" : "exit", code });
      });
    });

    if (result.status === "running") return port;
    if (result.status === "conflict") {
      process.stderr.write(`[dev] port ${port} in use, trying next\n`);
      continue;
    }

    process.stderr.write("[dev] server exited unexpectedly\n");
    shutdown(1);
    return;
  }

  process.stderr.write("[dev] failed to find an open port for server\n");
  shutdown(1);
  return null;
};

const startVite = async (serverPort) => {
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = basePort + attempt;
    process.stderr.write(`[dev] starting vite on port ${port}\n`);

    const child = spawn(
      process.execPath,
      [vitePath, "--port", String(port), "--host", "127.0.0.1", "--strictPort"],
      {
        cwd: path.join(root, "public"),
        env: {
          ...process.env,
          CONSENSUS_UI_PORT: String(port),
          CONSENSUS_PORT: String(serverPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let output = "";
    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const result = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        children.push(child);
        resolve({ status: "running" });
      }, 1500);

      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const conflict = /EADDRINUSE|address already in use|port .* in use/i.test(
          output
        );
        resolve({ status: conflict ? "conflict" : "exit", code });
      });
    });

    if (result.status === "running") return;
    if (result.status === "conflict") {
      process.stderr.write(`[dev] port ${port} in use, trying next\n`);
      continue;
    }

    process.stderr.write("[dev] vite exited unexpectedly\n");
    shutdown(1);
    return;
  }

  process.stderr.write("[dev] failed to find an open port for vite\n");
  shutdown(1);
};

const main = async () => {
  const serverPort = await startServer();
  if (!serverPort) return;
  await startVite(serverPort);
};

void main();

const shutdown = (code = 0) => {
  for (const child of children) {
    if (child.killed) continue;
    child.kill("SIGTERM");
  }
  process.exit(code);
};

tsc.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
