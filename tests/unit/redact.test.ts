import test from "node:test";
import assert from "node:assert/strict";
import { redactText } from "../../src/redact.ts";

test("redacts home directories and emails", () => {
  const input = "/Users/alice/project alice@example.com";
  const output = redactText(input);
  assert.equal(output, "~/project <redacted-email>");
});
