import test from "node:test";
import assert from "node:assert/strict";
import { hasCodexToken, hasCodexVendorPath, isCodexBinary } from "../../src/codexCmd.ts";

test("codex command matching recognizes codex-cli", () => {
  assert.equal(isCodexBinary("codex"), true);
  assert.equal(isCodexBinary("codex.exe"), true);
  assert.equal(isCodexBinary("codex-cli"), true);
  assert.equal(isCodexBinary("codex-cli.exe"), true);
  assert.equal(isCodexBinary("/usr/local/bin/codex-cli"), true);
  assert.equal(isCodexBinary('"/usr/local/bin/codex-cli"'), true);
  assert.equal(isCodexBinary("codexer"), false);
});

test("codex token matching recognizes cli invocation", () => {
  assert.equal(hasCodexToken("codex-cli exec --foo"), true);
  assert.equal(hasCodexToken("node /opt/bin/codex-cli exec"), true);
  assert.equal(hasCodexToken("/opt/bin/codex-cli.exe"), true);
  assert.equal(hasCodexToken("/opt/bin/codex.exe"), true);
  assert.equal(hasCodexToken("mycodex"), false);
});

test("codex vendor path matching", () => {
  assert.equal(hasCodexVendorPath("/Users/me/codex/vendor/bin"), true);
  assert.equal(hasCodexVendorPath("/Users/me/.codex/bin"), false);
});
