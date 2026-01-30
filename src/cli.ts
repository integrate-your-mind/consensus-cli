#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
import process from "process";
import { Effect, Console } from "effect";
import {
  annotateSpan,
  disposeObservability,
  runPromise,
  withSpan,
} from "./observability/index.js";
import { runSetup } from "./cli/setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

// Handle setup command
if (args[0] === "setup") {
  runSetup()
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
  // Exit early - don't start server
} else {

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
  process.stdout.write(`Usage:\n  consensus [command] [options]\n\n`);
  process.stdout.write(`Commands:\n`);
  process.stdout.write(`  setup                Configure Codex notify hook (recommended first step)\n`);
  process.stdout.write(`  (default)            Start the consensus server\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --host <host>        Bind address (default 127.0.0.1)\n`);
  process.stdout.write(`  --port <port>        Port (default 8787)\n`);
  process.stdout.write(`  --poll <ms>          Poll interval in ms\n`);
  process.stdout.write(`  --codex-home <path>  Override CODEX_HOME\n`);
  process.stdout.write(`  --codex-notify <path>  Install Codex notify hook at path\n`);
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
const codexNotify = readArg("--codex-notify");
const opencodeHost = readArg("--opencode-host");
const opencodePort = readArg("--opencode-port");
const noOpenCodeAutostart = hasFlag("--no-opencode-autostart");
const match = readArg("--process-match");
const noRedact = hasFlag("--no-redact");

if (host) env.CONSENSUS_HOST = host;
if (port) env.CONSENSUS_PORT = port;
if (poll) env.CONSENSUS_POLL_MS = poll;
if (codexHome) env.CONSENSUS_CODEX_HOME = codexHome;
const normalizeNotify = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const lowered = value.trim().toLowerCase();
  if (!lowered || lowered === "0" || lowered === "false" || lowered === "off") {
    return undefined;
  }
  return value;
};
const defaultNotifyPath = path.join(__dirname, "codexNotify.js");
const resolvedNotify =
  normalizeNotify(codexNotify) ||
  normalizeNotify(env.CONSENSUS_CODEX_NOTIFY_INSTALL) ||
  (fs.existsSync(defaultNotifyPath) ? defaultNotifyPath : undefined);
if (resolvedNotify) env.CONSENSUS_CODEX_NOTIFY_INSTALL = resolvedNotify;
if (opencodeHost) env.CONSENSUS_OPENCODE_HOST = opencodeHost;
if (opencodePort) env.CONSENSUS_OPENCODE_PORT = opencodePort;
if (noOpenCodeAutostart) env.CONSENSUS_OPENCODE_AUTOSTART = "0";
if (match) env.CONSENSUS_PROCESS_MATCH = match;
if (noRedact) env.CONSENSUS_REDACT_PII = "0";

const serverPath = path.join(__dirname, "server.js");
const spanAttributes: Record<string, string | number | boolean> = {
  "cli.args_count": args.length,
};
if (host) spanAttributes["consensus.host"] = host;
if (port) spanAttributes["consensus.port"] = Number(port);
if (poll) spanAttributes["consensus.poll_ms"] = Number(poll);
if (opencodeHost) spanAttributes["consensus.opencode_host"] = opencodeHost;
if (opencodePort) spanAttributes["consensus.opencode_port"] = Number(opencodePort);

const program = Effect.async<number, never>((resume) => {
  const child = spawn(process.execPath, [serverPath], { stdio: "inherit", env });
  child.on("exit", (code) => {
    resume(Effect.succeed(code ?? 0));
  });
});

const instrumented = program.pipe(
  withSpan("cli.run", { attributes: spanAttributes }),
  Effect.tap((code) => annotateSpan("process.exit_code", code))
);

runPromise(instrumented)
  .then(async (code) => {
    await disposeObservability().catch(() => undefined);
    process.exit(code);
  })
  .catch(async (err) => {
    process.stderr.write(`[consensus] cli error: ${String(err)}\n`);
    await disposeObservability().catch(() => undefined);
    process.exit(1);
  });
}
