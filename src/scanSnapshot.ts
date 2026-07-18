import type { ScanOptions } from "./scan.js";
import { scanCodexProcesses } from "./scan.js";
import { attachClaudeEvents } from "./claudeSnapshot.js";
import { hydrateClaudeEventsFromDisk } from "./services/claudeEvents.js";
import type { SnapshotPayload } from "./types.js";

export async function scanSnapshot(
  options: ScanOptions = { mode: "full" }
): Promise<SnapshotPayload> {
  await hydrateClaudeEventsFromDisk();
  const snapshot = await scanCodexProcesses(options);
  return attachClaudeEvents(snapshot);
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("scanSnapshot.js") ||
    process.argv[1].endsWith("scanSnapshot.ts"));

if (isDirectRun) {
  scanSnapshot({ mode: "full" })
    .then((snapshot) => {
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`[consensus] scan error: ${String(error)}\n`);
      process.exit(1);
    });
}
