import { execFile, spawn } from "child_process";
import { promisify } from "util";
import type { OpenCodeSessionResult } from "./opencodeApi.js";
import { getOpenCodeSessions } from "./opencodeApi.js";

const execFileAsync = promisify(execFile);

const AUTOSTART_ENABLED = process.env.CONSENSUS_OPENCODE_AUTOSTART !== "0";
const CHECK_INTERVAL_MS = 30_000;
const INSTALL_CHECK_INTERVAL_MS = 5 * 60_000;
const START_BACKOFF_MS = 60_000;

let lastAttemptAt = 0;
let lastInstallCheck = 0;
let lastStartAt = 0;
let opencodeInstalled: boolean | null = null;
let startedPid: number | null = null;
let startInFlight = false;

async function isOpenCodeInstalled(): Promise<boolean> {
  const now = Date.now();
  if (opencodeInstalled !== null && now - lastInstallCheck < INSTALL_CHECK_INTERVAL_MS) {
    return opencodeInstalled;
  }
  lastInstallCheck = now;
  try {
    await execFileAsync("opencode", ["--version"]);
    opencodeInstalled = true;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      opencodeInstalled = false;
    } else {
      opencodeInstalled = true;
    }
  }
  return opencodeInstalled;
}

function spawnOpenCodeServer(host: string, port: number): void {
  if (startInFlight) return;
  startInFlight = true;
  const child = spawn(
    "opencode",
    ["serve", "--hostname", host, "--port", String(port)],
    {
      stdio: "ignore",
      detached: true,
    }
  );
  child.unref();
  startedPid = child.pid ?? null;
  child.on("error", () => {
    startInFlight = false;
  });
  child.on("spawn", () => {
    startInFlight = false;
  });
}

export async function ensureOpenCodeServer(
  host: string,
  port: number,
  existingResult?: OpenCodeSessionResult
): Promise<void> {
  if (!AUTOSTART_ENABLED) return;
  const now = Date.now();
  if (now - lastAttemptAt < CHECK_INTERVAL_MS) return;
  lastAttemptAt = now;

  const installed = await isOpenCodeInstalled();
  if (!installed) return;

  const result =
    existingResult ?? (await getOpenCodeSessions(host, port, { silent: true }));
  if (result.ok) return;
  if (result.reachable) return;

  if (now - lastStartAt < START_BACKOFF_MS) return;
  lastStartAt = now;
  spawnOpenCodeServer(host, port);
}

function stopOpenCodeServer(): void {
  if (!startedPid) return;
  try {
    process.kill(startedPid);
  } catch {
    // ignore failures
  }
  startedPid = null;
}

process.on("exit", stopOpenCodeServer);
process.on("SIGINT", () => {
  stopOpenCodeServer();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopOpenCodeServer();
  process.exit(0);
});
