import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseGraph } from "./validate.js";
import type { GraphParseResult } from "./types.js";

export interface LoadedGraphFile {
  path: string;
  result: GraphParseResult;
}

export class GraphFileReadError extends Error {
  readonly path: string;

  constructor(filePath: string, message: string) {
    super(message);
    this.name = "GraphFileReadError";
    this.path = filePath;
  }
}

export async function loadGraphFile(filePath: string): Promise<LoadedGraphFile> {
  const absolutePath = path.resolve(filePath);
  let source: string;

  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new GraphFileReadError(
      absolutePath,
      `Could not read graph file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new GraphFileReadError(
      absolutePath,
      `Graph file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    path: absolutePath,
    result: parseGraph(value),
  };
}
