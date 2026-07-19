import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  harnessDefinitions,
  harnessForId,
  harnessIds,
  type HarnessDefinition,
  type HarnessId,
} from "../harnesses.js";
import { isHookHarnessId } from "../harnessHookModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isHarnessId(value: string): value is HarnessId {
  return (harnessIds as readonly string[]).includes(value);
}

function help(): string {
  return [
    "consensus harnesses",
    "",
    "List registered coding-agent harnesses and their evidence sources.",
    "",
    "Usage:",
    "  consensus harnesses [--json]",
    "  consensus harnesses --setup <harness>",
    "",
    "Options:",
    "  --json                 Print the registry as JSON",
    "  --setup <harness>      Print hook or adapter setup guidance",
    "  -h, --help             Show this help",
    "",
  ].join("\n");
}

function setupCommand(scriptPath: string, harnessId: HarnessId): string {
  return `node ${JSON.stringify(scriptPath)} ${harnessId}`;
}

export function harnessSetupText(
  harness: HarnessDefinition,
  scriptPath: string
): string {
  const lines = [
    `${harness.displayName} (${harness.id})`,
    `class=${harness.class} telemetry=${harness.telemetry}`,
  ];
  if (harness.docs) lines.push(`docs=${harness.docs}`);

  if (isHookHarnessId(harness.id)) {
    lines.push(
      "",
      "Configure each supported lifecycle event to run this command and pass the hook JSON on stdin:",
      `  ${setupCommand(scriptPath, harness.id)}`,
      "",
      "Consensus stores only normalized event type, opaque session/cwd/turn keys, timestamp, and small tool/agent labels.",
      "Prompt text, tool input/output, transcript paths, raw session IDs, and error details are discarded before persistence."
    );
  } else if (harness.telemetry === "native-events") {
    lines.push(
      "",
      "This harness needs a native event adapter. Process discovery is available where an exact binary rule exists."
    );
  } else if (harness.telemetry === "structured-stream") {
    lines.push(
      "",
      "Run history should be attached through the harness's structured output stream. Process discovery alone has no step graph."
    );
  } else if (harness.telemetry === "remote-api") {
    lines.push(
      "",
      "Run history requires an explicit, opt-in remote API adapter. Local process discovery does not fetch remote data."
    );
  } else if (harness.telemetry === "tool-only") {
    lines.push(
      "",
      "This entry represents a tool/model integration. Consensus attributes the execution loop to the owning harness."
    );
  } else if (harness.telemetry === "manual") {
    lines.push(
      "",
      "This IDE agent needs an extension bridge. Consensus does not identify it from generic Electron helper processes."
    );
  } else {
    lines.push(
      "",
      "Current depth is exact process discovery only; no step history is claimed."
    );
  }

  if (harness.note) lines.push("", `note=${harness.note}`);
  return `${lines.join("\n")}\n`;
}

function formatRegistry(): string {
  const rows = harnessDefinitions.map((harness) => ({
    name: harness.displayName,
    id: harness.id,
    class: harness.class,
    telemetry: harness.telemetry,
    discovery: harness.processRules?.length ? "process" : "adapter",
  }));
  const widths = {
    name: Math.max("HARNESS".length, ...rows.map((row) => row.name.length)),
    id: Math.max("ID".length, ...rows.map((row) => row.id.length)),
    class: Math.max("CLASS".length, ...rows.map((row) => row.class.length)),
    telemetry: Math.max(
      "EVIDENCE".length,
      ...rows.map((row) => row.telemetry.length)
    ),
  };
  const line = (row: (typeof rows)[number]): string =>
    `${row.name.padEnd(widths.name)}  ${row.id.padEnd(widths.id)}  ` +
    `${row.class.padEnd(widths.class)}  ${row.telemetry.padEnd(widths.telemetry)}  ` +
    row.discovery;
  return [
    `${"HARNESS".padEnd(widths.name)}  ${"ID".padEnd(widths.id)}  ` +
      `${"CLASS".padEnd(widths.class)}  ${"EVIDENCE".padEnd(widths.telemetry)}  DISCOVERY`,
    ...rows.map(line),
    "",
    "Use `consensus harnesses --setup <id>` for the provider-specific next step.",
    "",
  ].join("\n");
}

export async function runHarnesses(args: string[]): Promise<void> {
  let json = false;
  let setupId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(help());
      return;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--setup") {
      setupId = args[index + 1];
      if (!setupId) throw new Error("--setup requires a harness id");
      index += 1;
      continue;
    }
    if (arg.startsWith("--setup=")) {
      setupId = arg.slice("--setup=".length);
      if (!setupId) throw new Error("--setup requires a harness id");
      continue;
    }
    throw new Error(`unknown harnesses option: ${arg}`);
  }

  if (setupId) {
    if (!isHarnessId(setupId)) {
      throw new Error(`unknown harness id: ${setupId}`);
    }
    const scriptPath = path.resolve(__dirname, "..", "harnessHook.js");
    process.stdout.write(harnessSetupText(harnessForId(setupId), scriptPath));
    return;
  }

  process.stdout.write(
    json
      ? `${JSON.stringify({ version: 1, harnesses: harnessDefinitions }, null, 2)}\n`
      : formatRegistry()
  );
}
