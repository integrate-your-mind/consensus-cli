import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function loadLayoutFns(): Promise<{
  agentIdentity: (agent: Record<string, unknown>) => unknown;
  groupKeyForAgent: (agent: Record<string, unknown>) => unknown;
  keyForAgent: (agent: Record<string, unknown>) => string;
}> {
  const source = await fs.readFile(path.join(process.cwd(), "public/app.js"), "utf8");
  const identityMatch = source.match(/function agentIdentity\(agent\) \{[\s\S]*?\n\}/);
  const groupMatch = source.match(/function groupKeyForAgent\(agent\) \{[\s\S]*?\n\}/);
  const keyMatch = source.match(/function keyForAgent\(agent\) \{[\s\S]*?\n\}/);
  assert.ok(identityMatch, "agentIdentity not found in public/app.js");
  assert.ok(groupMatch, "groupKeyForAgent not found in public/app.js");
  assert.ok(keyMatch, "keyForAgent not found in public/app.js");
  const factory = new Function(
    `${identityMatch[0]}\n${groupMatch[0]}\n${keyMatch[0]}\nreturn { agentIdentity, groupKeyForAgent, keyForAgent };`
  ) as () => {
    agentIdentity: (agent: Record<string, unknown>) => unknown;
    groupKeyForAgent: (agent: Record<string, unknown>) => unknown;
    keyForAgent: (agent: Record<string, unknown>) => string;
  };
  return factory();
}

test("keeps unique layout keys for same repo with different pids", async () => {
  const { groupKeyForAgent, keyForAgent } = await loadLayoutFns();
  const agentA = { repo: "alpha", id: "101" };
  const agentB = { repo: "alpha", id: "202" };
  assert.equal(groupKeyForAgent(agentA), "alpha");
  assert.equal(groupKeyForAgent(agentB), "alpha");
  assert.notEqual(keyForAgent(agentA), keyForAgent(agentB));
});

test("falls back to id when repo is missing to avoid collisions", async () => {
  const { groupKeyForAgent, keyForAgent } = await loadLayoutFns();
  const agentA = { id: "303" };
  const agentB = { id: "404" };
  assert.equal(groupKeyForAgent(agentA), "303");
  assert.equal(groupKeyForAgent(agentB), "404");
  assert.notEqual(keyForAgent(agentA), keyForAgent(agentB));
});
