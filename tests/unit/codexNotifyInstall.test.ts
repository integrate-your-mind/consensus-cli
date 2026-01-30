import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCodexNotifyInstall } from "../../src/codexNotifyInstall.ts";

test("normalizeCodexNotifyInstall disables empty/falsey values", () => {
  assert.equal(normalizeCodexNotifyInstall(undefined), null);
  assert.equal(normalizeCodexNotifyInstall(""), null);
  assert.equal(normalizeCodexNotifyInstall("   "), null);
  assert.equal(normalizeCodexNotifyInstall("0"), null);
  assert.equal(normalizeCodexNotifyInstall(" false "), null);
  assert.equal(normalizeCodexNotifyInstall("FALSE"), null);
});

test("normalizeCodexNotifyInstall preserves non-empty paths", () => {
  assert.equal(normalizeCodexNotifyInstall("/tmp/hook"), "/tmp/hook");
  assert.equal(normalizeCodexNotifyInstall("  /opt/notify.js "), "/opt/notify.js");
});
