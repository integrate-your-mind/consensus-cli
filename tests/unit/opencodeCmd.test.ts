import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenCodeCommand, summarizeOpenCodeCommand } from "../../src/opencodeCmd.ts";

test("opencode run with server word in prompt stays cli", () => {
  const info = parseOpenCodeCommand("opencode run \"server-side topic exploration\"");
  assert.equal(info?.kind, "opencode-cli");
});

test("opencode serve is server", () => {
  const info = parseOpenCodeCommand("opencode serve --port 4096");
  assert.equal(info?.kind, "opencode-server");
});

test("opencode web is server", () => {
  const info = parseOpenCodeCommand("/usr/local/bin/opencode web");
  assert.equal(info?.kind, "opencode-server");
});

test("opencode run summarizes prompt", () => {
  const summary = summarizeOpenCodeCommand("opencode run --model gpt-4o \"hello\"");
  assert.equal(summary?.doing, "opencode run: hello");
});

test("opencode default is tui", () => {
  const info = parseOpenCodeCommand("opencode");
  assert.equal(info?.kind, "opencode-tui");
});

test("opencode hostname/port flags imply server", () => {
  const info = parseOpenCodeCommand("opencode --hostname 127.0.0.1 --port 4096");
  assert.equal(info?.kind, "opencode-server");
});
