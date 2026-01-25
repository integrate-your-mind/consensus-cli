#!/usr/bin/env node
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

function readArg(name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index === -1) return undefined;
  const arg = args[index];
  if (arg.includes("=")) {
    return arg.split("=").slice(1).join("=");
  }
  return args[index + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function printHelp(): void {
  process.stdout.write(`consensus\n\n`);
  process.stdout.write(`Usage:\n  consensus [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --host <host>        Bind address (default 127.0.0.1)\n`);
  process.stdout.write(`  --port <port>        Port (default 8787)\n`);
  process.stdout.write(`  --poll <ms>          Poll interval in ms\n`);
  process.stdout.write(`  --codex-home <path>  Override CODEX_HOME\n`);
  process.stdout.write(`  --opencode-host <h>  OpenCode host (default 127.0.0.1)\n`);
  process.stdout.write(`  --opencode-port <p>  OpenCode port (default 4096)\n`);
  process.stdout.write(`  --no-opencode-autostart  Disable OpenCode server autostart\n`);
  process.stdout.write(`  --process-match <re> Regex for process matching\n`);
  process.stdout.write(`  --no-redact          Disable PII redaction\n`);
  process.stdout.write(`  -h, --help           Show help\n`);
}

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}

const env = { ...process.env } as Record<string, string>;

const host = readArg("--host");
const port = readArg("--port");
const poll = readArg("--poll");
const codexHome = readArg("--codex-home");
const opencodeHost = readArg("--opencode-host");
const opencodePort = readArg("--opencode-port");
const noOpenCodeAutostart = hasFlag("--no-opencode-autostart");
const match = readArg("--process-match");
const noRedact = hasFlag("--no-redact");

if (host) env.CONSENSUS_HOST = host;
if (port) env.CONSENSUS_PORT = port;
if (poll) env.CONSENSUS_POLL_MS = poll;
if (codexHome) env.CONSENSUS_CODEX_HOME = codexHome;
if (opencodeHost) env.CONSENSUS_OPENCODE_HOST = opencodeHost;
if (opencodePort) env.CONSENSUS_OPENCODE_PORT = opencodePort;
if (noOpenCodeAutostart) env.CONSENSUS_OPENCODE_AUTOSTART = "0";
if (match) env.CONSENSUS_PROCESS_MATCH = match;
if (noRedact) env.CONSENSUS_REDACT_PII = "0";

const serverPath = path.join(__dirname, "server.js");
const child = spawn(process.execPath, [serverPath], { stdio: "inherit", env });
child.on("exit", (code) => {
  process.exit(code ?? 0);
});
