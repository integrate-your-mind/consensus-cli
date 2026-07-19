import test from "node:test";
import assert from "node:assert/strict";
import {
  createCodexHome,
  createTempProject,
  delay,
  fetchSnapshot,
  getFreePort,
  isCodexAvailable,
  isTmuxAvailable,
  startCodexInteractiveInTmux,
  startConsensusServer,
  startTmuxSession,
  waitForCodexPid,
  waitForPaneOutput,
  waitForSessionFile,
} from "./liveCodexHarness.ts";
import type { SnapshotPayload, AgentSnapshot } from "../../src/types.ts";

const liveEnabled = process.env.RUN_LIVE_CODEX === "1";
const liveTest = liveEnabled ? test : test.skip;

async function waitForAgent(
  port: number,
  sessionPath: string,
  cwd: string,
  pid: number | undefined,
  tag: string,
  timeoutMs: number
): Promise<AgentSnapshot> {
  const sessionBase = sessionPath ? sessionPath.split("/").pop() : undefined;
  const cwdBase = cwd ? cwd.split("/").pop() : undefined;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = (await fetchSnapshot(port)) as SnapshotPayload;
    const agent = snapshot.agents.find((item) => {
      if (pid && item.pid === pid) return true;
      if (sessionBase && item.sessionPath?.includes(sessionBase)) return true;
      if (item.sessionPath && sessionPath && item.sessionPath === sessionPath) return true;
      if (item.cwd && cwd && item.cwd === cwd) return true;
      if (cwdBase && item.cwd?.includes(cwdBase)) return true;
      if (item.cmd?.includes(tag) || item.cmdShort?.includes(tag)) return true;
      return false;
    });
    if (agent) return agent;
    await delay(200);
  }
  const snapshot = (await fetchSnapshot(port)) as SnapshotPayload;
  const summary = snapshot.agents.map((item) => ({
    id: item.id,
    cmd: item.cmdShort,
    cwd: item.cwd,
    sessionPath: item.sessionPath,
    state: item.state,
  }));
  throw new Error(`Timed out waiting for codex agent in snapshot. Agents: ${JSON.stringify(summary)}`);
}

async function collectStateHistory(
  port: number,
  agentId: string,
  durationMs: number,
  intervalMs: number
): Promise<
  Array<{ ts: number; state: string; reason?: string; lastTool?: string; lastCommand?: string }>
> {
  const history: Array<{
    ts: number;
    state: string;
    reason?: string;
    lastTool?: string;
    lastCommand?: string;
  }> = [];
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const snapshot = (await fetchSnapshot(port)) as SnapshotPayload;
    const agent = snapshot.agents.find((item) => item.id === agentId);
    if (agent) {
      history.push({
        ts: Date.now(),
        state: agent.state,
        reason: agent.activityReason,
        lastTool: agent.summary?.lastTool,
        lastCommand: agent.summary?.lastCommand,
      });
    }
    await delay(intervalMs);
  }
  return history;
}

liveTest(
  "live codex keeps active during long tool execution",
  { timeout: 240_000 },
  async (t) => {
    if (!(await isTmuxAvailable())) {
      t.skip("tmux not available");
      return;
    }

    const codexBin = process.env.CODEX_BIN;
    if (!(await isCodexAvailable(codexBin))) {
      t.skip("codex binary not available");
      return;
    }

    const testTag = `consensus-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const project = await createTempProject();
    const codexHome = await createCodexHome();
    const port = await getFreePort();
    const server = await startConsensusServer({
      port,
      codexHome: codexHome.home,
      debugActivity: true,
    });
    const tmux = await startTmuxSession();

    const debugEnv = process.env.CODEX_DEBUG_ENV ?? "RUST_LOG=debug";

    try {
      const startAt = Date.now();
      await startCodexInteractiveInTmux({
        session: tmux,
        projectDir: project.root,
        codexHome: codexHome.home,
        codexRoot: codexHome.root,
        codexBin,
        debugEnv,
      });

      await waitForPaneOutput(
        tmux,
        (output) => output.trim().length > 0,
        10_000
      );
      await tmux.sendText(`Run bash: sleep 35. Tag: ${testTag}`);

      const paneOutput = await waitForPaneOutput(
        tmux,
        (output) => output.trim().length > 0,
        10_000
      );
      if (/unauthorized|login|api key|missing bearer/i.test(paneOutput)) {
        t.skip("codex auth required in this environment");
        return;
      }

      let sessionPath = "";
      let pid: number | undefined;
      try {
        sessionPath = await waitForSessionFile(codexHome.home, 30_000, startAt);
        pid = await waitForCodexPid({ startAfterMs: startAt, timeoutMs: 10_000 });
      } catch (err) {
        const excerpt = paneOutput.slice(-500);
        t.skip(`codex did not start session or pid: ${String(err)}\n${excerpt}`);
        return;
      }
      const agent = await waitForAgent(port, sessionPath, project.root, pid, testTag, 30_000);

      const history = await collectStateHistory(port, agent.id, 40_000, 1000);

      const firstActive = history.find((entry) => entry.state === "active");
      assert.ok(firstActive, "agent never became active");

      const windowStart = firstActive.ts;
      const windowEnd = windowStart + 30_000;
      const idleDuring = history.filter(
        (entry) =>
          entry.ts >= windowStart && entry.ts <= windowEnd && entry.state === "idle"
      );
      assert.equal(
        idleDuring.length,
        0,
        `idle transitions detected during long tool execution: ${idleDuring.length}`
      );

      const sawTool = history.some((entry) => entry.lastTool?.includes("tool:"));
      const sawCommand = history.some((entry) => entry.lastCommand?.includes("cmd:"));
      assert.ok(
        sawTool || sawCommand,
        "no tool or command activity detected in snapshot summaries"
      );
    } finally {
      await tmux.kill();
      await server.stop();
      await project.cleanup();
      await codexHome.cleanup();
    }
  }
);

liveTest(
  "live codex avoids idle gaps during sequential tools",
  { timeout: 200_000 },
  async (t) => {
    if (!(await isTmuxAvailable())) {
      t.skip("tmux not available");
      return;
    }

    const codexBin = process.env.CODEX_BIN;
    if (!(await isCodexAvailable(codexBin))) {
      t.skip("codex binary not available");
      return;
    }

    const testTag = `consensus-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const project = await createTempProject();
    const codexHome = await createCodexHome();
    const port = await getFreePort();
    const server = await startConsensusServer({
      port,
      codexHome: codexHome.home,
      debugActivity: true,
    });
    const tmux = await startTmuxSession();
    const debugEnv = process.env.CODEX_DEBUG_ENV ?? "RUST_LOG=debug";

    try {
      const startAt = Date.now();
      await startCodexInteractiveInTmux({
        session: tmux,
        projectDir: project.root,
        codexHome: codexHome.home,
        codexRoot: codexHome.root,
        codexBin,
        debugEnv,
      });

      await waitForPaneOutput(
        tmux,
        (output) => output.trim().length > 0,
        10_000
      );
      await tmux.sendText(
        `Run bash: sleep 2; then run bash: sleep 2; then run bash: sleep 2. Tag: ${testTag}`
      );

      const paneOutput = await waitForPaneOutput(
        tmux,
        (output) => output.trim().length > 0,
        10_000
      );
      if (/unauthorized|login|api key|missing bearer/i.test(paneOutput)) {
        t.skip("codex auth required in this environment");
        return;
      }

      let sessionPath = "";
      let pid: number | undefined;
      try {
        sessionPath = await waitForSessionFile(codexHome.home, 30_000, startAt);
        pid = await waitForCodexPid({ startAfterMs: startAt, timeoutMs: 10_000 });
      } catch (err) {
        const excerpt = paneOutput.slice(-500);
        t.skip(`codex did not start session or pid: ${String(err)}\n${excerpt}`);
        return;
      }
      const agent = await waitForAgent(port, sessionPath, project.root, pid, testTag, 30_000);

      const history = await collectStateHistory(port, agent.id, 15_000, 500);

      const firstActive = history.find((entry) => entry.state === "active");
      assert.ok(firstActive, "agent never became active");

      const windowStart = firstActive.ts;
      const windowEnd = windowStart + 6_000;
      const idleDuring = history.filter(
        (entry) =>
          entry.ts >= windowStart && entry.ts <= windowEnd && entry.state === "idle"
      );
      assert.equal(
        idleDuring.length,
        0,
        `idle transitions detected during sequential tools: ${idleDuring.length}`
      );
    } finally {
      await tmux.kill();
      await server.stop();
      await project.cleanup();
      await codexHome.cleanup();
    }
  }
);
