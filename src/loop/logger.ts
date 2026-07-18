import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { GraphRunEvent } from "./types.js";

export interface JsonlEventLogger {
  readonly path: string;
  write(event: GraphRunEvent): Promise<void>;
  close(): Promise<void>;
}

function safePathSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "graph";
}

export function defaultRunLogPath(
  baseDirectory: string,
  graphId: string,
  runId: string,
): string {
  return path.join(
    path.resolve(baseDirectory),
    ".consensus",
    "runs",
    safePathSegment(graphId),
    `${safePathSegment(runId)}.jsonl`,
  );
}

export async function createJsonlEventLogger(filePath: string): Promise<JsonlEventLogger> {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });

  const handle: FileHandle = await open(absolutePath, "wx");
  let pending = Promise.resolve();
  let closed = false;

  return {
    path: absolutePath,
    write(event: GraphRunEvent): Promise<void> {
      if (closed) {
        return Promise.reject(new Error(`Run log is already closed: ${absolutePath}`));
      }
      pending = pending.then(async () => {
        await handle.appendFile(`${JSON.stringify(event)}\n`, "utf8");
      });
      return pending;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pending;
      await handle.close();
    },
  };
}
