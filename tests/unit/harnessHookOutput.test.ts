import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { harnessHookAcknowledgement } from "../../src/harnessHookOutput.js";

describe("harness hook acknowledgements", () => {
  it("returns compact JSON for harnesses that require JSON stdout", () => {
    assert.equal(harnessHookAcknowledgement("gemini"), "{}\n");
    assert.equal(harnessHookAcknowledgement("copilot"), "{}\n");
  });

  it("keeps stdout empty for harnesses with passive command hooks", () => {
    assert.equal(harnessHookAcknowledgement("claude"), "");
    assert.equal(harnessHookAcknowledgement("hermes"), "");
    assert.equal(harnessHookAcknowledgement("kimi"), "");
    assert.equal(harnessHookAcknowledgement("factory"), "");
    assert.equal(harnessHookAcknowledgement("qwen"), "");
  });
});
