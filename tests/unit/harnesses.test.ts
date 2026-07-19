import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentKinds,
  detectGenericHarnessProcess,
  harnessDefinitions,
  harnessIdForKind,
  isAgentKind,
} from "../../src/harnesses.js";

describe("harness registry", () => {
  it("maps every agent kind to exactly one harness", () => {
    const seen = new Map<string, string>();
    for (const harness of harnessDefinitions) {
      for (const kind of harness.kinds) {
        assert.equal(seen.has(kind), false, `${kind} mapped more than once`);
        seen.set(kind, harness.id);
      }
    }

    assert.deepEqual([...seen.keys()].sort(), [...agentKinds].sort());
    for (const kind of agentKinds) {
      assert.equal(isAgentKind(kind), true);
      assert.equal(harnessIdForKind(kind), seen.get(kind));
    }
  });

  it("detects the named local harness binaries", () => {
    const cases = [
      ["openclaw agent --message test", "openclaw", "openclaw-cli"],
      ["openclaw gateway", "openclaw", "openclaw-server"],
      ["hermes chat", "hermes", "hermes-cli"],
      ["hermes gateway", "hermes", "hermes-server"],
      ["kimi --resume session", "kimi", "kimi-cli"],
      ["mmx video generate", "minimax", "minimax-cli"],
      ["cursor-agent --print task", "cursor", "cursor-cli"],
      ["oz agent run --prompt task", "warp", "warp-cli"],
      ["droid", "factory", "factory-cli"],
      ["gemini", "gemini", "gemini-cli"],
      ["qwen-code", "qwen", "qwen-cli"],
      ["q chat", "amazon-q", "amazon-q-cli"],
      ["kiro-cli", "kiro", "kiro-cli"],
      ["openhands", "openhands", "openhands-cli"],
    ] as const;

    for (const [command, harnessId, kind] of cases) {
      const detected = detectGenericHarnessProcess(command, undefined);
      assert.equal(detected?.harness.id, harnessId, command);
      assert.equal(detected?.kind, kind, command);
    }
  });

  it("uses the executable token instead of matching names mentioned in prompts", () => {
    assert.equal(
      detectGenericHarnessProcess("node runner.js --prompt 'use openclaw'", "node"),
      undefined
    );
    assert.equal(detectGenericHarnessProcess("oz config list", "oz"), undefined);
    assert.equal(detectGenericHarnessProcess("q --version", "q"), undefined);
    assert.equal(detectGenericHarnessProcess("agent --print task", "agent"), undefined);
  });

  it("prefers server rules before broad CLI rules", () => {
    assert.equal(
      detectGenericHarnessProcess("openclaw daemon", "openclaw")?.kind,
      "openclaw-server"
    );
    assert.equal(
      detectGenericHarnessProcess("hermes serve", "hermes")?.kind,
      "hermes-server"
    );
  });
});
