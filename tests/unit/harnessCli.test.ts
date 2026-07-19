import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  harnessSetupText,
} from "../../src/cli/harnesses.js";
import { harnessForId } from "../../src/harnesses.js";

describe("harness CLI", () => {
  it("prints a privacy-safe hook command for hook-capable harnesses", () => {
    const text = harnessSetupText(
      harnessForId("kimi"),
      "/Applications/Consensus/dist/harnessHook.js"
    );

    assert.match(
      text,
      /node "\/Applications\/Consensus\/dist\/harnessHook\.js" kimi/
    );
    assert.match(text, /Prompt text, tool input\/output/);
    assert.match(text, /telemetry=hooks/);
  });

  it("does not claim hook setup for process-only providers", () => {
    const text = harnessSetupText(
      harnessForId("gemini"),
      "/tmp/harnessHook.js"
    );

    assert.doesNotMatch(text, /node .*harnessHook/);
    assert.match(text, /process discovery only/i);
  });

  it("distinguishes MiniMax tool integration from an owning loop", () => {
    const text = harnessSetupText(
      harnessForId("minimax"),
      "/tmp/harnessHook.js"
    );

    assert.match(text, /tool\/model integration/i);
    assert.doesNotMatch(text, /Configure each supported lifecycle event/);
  });

  it("requires explicit adapters for IDE and remote harnesses", () => {
    assert.match(
      harnessSetupText(harnessForId("cline"), "/tmp/harnessHook.js"),
      /extension bridge/i
    );
    assert.match(
      harnessSetupText(harnessForId("warp"), "/tmp/harnessHook.js"),
      /remote API adapter/i
    );
  });
});
