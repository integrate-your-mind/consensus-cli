#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const TEST_FILE_RE = /\.(test|spec)\.ts$/;

function usage() {
  return [
    "Usage: node scripts/run-node-tests.js [--watch] <path...>",
    "",
    "Recursively finds *.test.ts / *.spec.ts under each provided path and runs:",
    "  node --test --import tsx <files...>",
    "",
    "Options:",
    "  --watch   Pass --watch to node --test",
    "",
  ].join("\n");
}

async function listTestFiles(entryPath) {
  const results = [];
  const st = await stat(entryPath);
  if (st.isFile()) {
    if (TEST_FILE_RE.test(entryPath)) results.push(entryPath);
    return results;
  }
  if (!st.isDirectory()) return results;

  const entries = await readdir(entryPath, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(entryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listTestFiles(nextPath)));
      continue;
    }
    if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      results.push(nextPath);
    }
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const watchIdx = argv.indexOf("--watch");
  const watch = watchIdx !== -1;
  if (watch) argv.splice(watchIdx, 1);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }

  if (argv.length === 0) {
    process.stderr.write("Missing test path(s).\n");
    process.stderr.write(`${usage()}\n`);
    return 1;
  }

  const roots = argv.map((p) => path.resolve(p));
  const files = [];
  for (const root of roots) {
    files.push(...(await listTestFiles(root)));
  }

  const unique = Array.from(new Set(files)).sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) {
    process.stderr.write(`No test files found under: ${roots.join(", ")}\n`);
    return 1;
  }

  const args = ["--test"];
  if (watch) args.push("--watch");
  args.push("--import", "tsx", ...unique);

  const child = spawn(process.execPath, args, { stdio: "inherit" });
  return await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 1;
  });

