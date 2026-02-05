import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import type { ConsensusConfig, HookSetupResult } from "../codex/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_VERSION = "1";
const CONSENSUS_CONFIG_PATH = path.join(os.homedir(), ".consensus", "config.json");

/**
 * Check if setup has already been completed
 */
export async function checkExistingSetup(): Promise<ConsensusConfig | null> {
  try {
    const content = await fs.readFile(CONSENSUS_CONFIG_PATH, "utf-8");
    return JSON.parse(content) as ConsensusConfig;
  } catch {
    return null;
  }
}

/**
 * Verify that the Codex config.toml actually has the notify hook configured
 */
async function verifyCodexHookInstalled(): Promise<boolean> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const notifyScript = path.resolve(__dirname, "..", "codexNotify.js");
    return (
      content.includes("/api/codex-event") &&
      (content.includes("codexNotify.js") || content.includes(notifyScript))
    );
  } catch {
    return false;
  }
}

/**
 * Save setup configuration
 */
async function saveSetupConfig(config: ConsensusConfig): Promise<void> {
  const configDir = path.dirname(CONSENSUS_CONFIG_PATH);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    CONSENSUS_CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

/**
 * Install Codex notify hook
 */
export async function setupCodexHook(): Promise<HookSetupResult> {
  const codexDir = path.join(os.homedir(), ".codex");
  const configPath = path.join(codexDir, "config.toml");
  const consensusPort = process.env.CONSENSUS_PORT 
    ? parseInt(process.env.CONSENSUS_PORT, 10) 
    : 8787;
  
  // Ensure .codex directory exists
  try {
    await fs.mkdir(codexDir, { recursive: true });
  } catch {
    // Directory might already exist
  }
  
  // Read existing config (if any)
  let existingContent = "";
  try {
    existingContent = await fs.readFile(configPath, "utf-8");
  } catch {
    // File doesn't exist, that's fine
  }
  
  // Generate notify script path (compiled JS in dist)
  const notifyScript = path.resolve(__dirname, "..", "codexNotify.js");
  
  const notifyLine = `notify = ["node", "${notifyScript}", "http://127.0.0.1:${consensusPort}/api/codex-event"] # consensus-cli`;
  const notificationsLine =
    'notifications = ["agent-turn-complete", "approval-requested"] # consensus-cli';

  const rawLines = existingContent.split(/\r?\n/);
  const filtered: string[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const trimmed = line.trim();
    const nextTrimmed = rawLines[i + 1]?.trim() ?? "";
    const isConsensusComment =
      trimmed.startsWith("#") && trimmed.includes("Added by consensus-cli");
    const isNotifyLine = trimmed.startsWith("notify =") && trimmed.includes("/api/codex-event");
    if (isNotifyLine) continue;
    if (isConsensusComment && nextTrimmed.startsWith("notify =") && nextTrimmed.includes("/api/codex-event")) {
      continue;
    }
    filtered.push(line);
  }

  const hasNotifyHook = filtered.some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("notify =") && trimmed.includes("/api/codex-event");
  });

  const lines = [...filtered];
  if (!hasNotifyHook) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push("# Added by consensus-cli");
    lines.push(notifyLine);
  }

  const tuiIndex = lines.findIndex((line) => line.trim() === "[tui]");
  if (tuiIndex === -1) {
    lines.push("");
    lines.push("[tui]");
    lines.push(notificationsLine);
  } else {
    const sectionEnd = (() => {
      for (let i = tuiIndex + 1; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) return i;
      }
      return lines.length;
    })();
    const notificationsIndex = (() => {
      for (let i = tuiIndex + 1; i < sectionEnd; i += 1) {
        if (lines[i].trim().startsWith("notifications =")) return i;
      }
      return -1;
    })();
    if (notificationsIndex === -1) {
      lines.splice(sectionEnd, 0, notificationsLine);
    } else if (lines[notificationsIndex].includes("consensus-cli")) {
      lines[notificationsIndex] = notificationsLine;
    }
  }

  const newContent = lines.join("\n").replace(/\n*$/, "\n");
  
  // Write config
  await fs.writeFile(configPath, newContent, "utf-8");
  
  console.log("✓ Codex notify hook configured");
  console.log(`  Config: ${configPath}`);
  console.log(`  Endpoint: http://127.0.0.1:${consensusPort}/api/codex-event`);
  
  return {
    _tag: "HookSetupResult" as const,
    configured: true,
    message: "Hook installed successfully",
    configPath
  };
}

/**
 * Main setup flow
 */
export async function runSetup(): Promise<void> {
  console.log("");
  console.log("🔧  Consensus Setup");
  console.log("═══════════════════");
  console.log("");
  
  // Check existing setup - but verify the hook is actually installed
  const existing = await checkExistingSetup();
  const hookActuallyInstalled = await verifyCodexHookInstalled();
  
  if (existing?.hookConfigured && hookActuallyInstalled) {
    console.log("✓  Consensus is already configured");
    console.log(`   Last setup: ${new Date(existing.setupCompletedAt).toLocaleString()}`);
    console.log("");
    return;
  }
  
  // If config says configured but hook is missing, inform user
  if (existing?.hookConfigured && !hookActuallyInstalled) {
    console.log("⚠  Previous setup detected but hook is missing from ~/.codex/config.toml");
    console.log("   Re-running setup...");
    console.log("");
  }
  
  console.log("Consensus can install Codex's notify hook to trigger faster UI updates.");
  console.log("Activity state is still derived from Codex session JSONL logs.");
  console.log("");
  
  console.log("Installing Codex notify hook...");
  console.log("");
  
  try {
    const result = await setupCodexHook();
    
    console.log("");
    console.log(result.message);
    
    // Save config
    const config: ConsensusConfig = {
      version: CONFIG_VERSION,
      hookConfigured: result.configured,
      otelEnabled: false,
      setupCompletedAt: Date.now()
    };
    
    await saveSetupConfig(config);
    
    console.log("");
    console.log("✅  Setup complete!");
    console.log("");
    console.log("Start Consensus:");
    console.log("  npm run dev");
    console.log("");
    console.log("Note: If Codex is already running, restart it for changes to take effect.");
    console.log("");
  } catch (error) {
    console.error(`\n❌  Setup failed: ${error}`);
    console.error("");
    throw error;
  }
}
