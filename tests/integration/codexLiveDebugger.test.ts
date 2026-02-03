import test from "node:test";
import assert from "node:assert/strict";
import {
  createCodexHome,
  createTempProject,
  delay,
  formatPaneExcerpt,
  getFreePort,
  isCodexAvailable,
  isTmuxAvailable,
  startCodexInteractiveInTmux,
  startConsensusServer,
  startTmuxSession,
  waitForCodexPid,
  waitForCodexReady,
  waitForSessionFile,
} from "./liveCodexHarness.ts";
import { CdpClient, buildMarkerIndex } from "./liveCdpClient.ts";

const liveEnabled = process.env.RUN_LIVE_CODEX === "1";
const liveTest = liveEnabled ? test : test.skip;

type MarkerIndex = Map<string, Map<number, string>>;
type ScriptIndex = Map<string, string>;

function markerForLocation(
  markers: MarkerIndex,
  scriptId: string,
  lineNumber: number
): string | undefined {
  const scriptMarkers = markers.get(scriptId);
  return scriptMarkers?.get(lineNumber);
}

async function markerForFrame(
  client: CdpClient,
  markers: MarkerIndex,
  scriptId: string,
  lineNumber: number
): Promise<string | undefined> {
  let scriptMarkers = markers.get(scriptId);
  if (!scriptMarkers) {
    const source = await client.getScriptSource(scriptId);
    scriptMarkers = buildMarkerIndex(source);
    if (scriptMarkers.size > 0) {
      markers.set(scriptId, scriptMarkers);
    }
  }
  return scriptMarkers?.get(lineNumber);
}

async function waitForScripts(
  scripts: ScriptIndex,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (scripts.size > 0) return;
    await delay(200);
  }
  throw new Error("Timed out waiting for scripts to parse");
}

async function setMarkerBreakpoints(
  client: CdpClient,
  scripts: ScriptIndex,
  markerIndex: MarkerIndex,
  markerNames: Set<string>
): Promise<void> {
  for (const [scriptId, url] of scripts.entries()) {
    if (!url.includes("codexLogs.ts") && !url.includes("scan.ts")) continue;
    const source = await client.getScriptSource(scriptId);
    const markers = buildMarkerIndex(source);
    if (markers.size === 0) continue;
    markerIndex.set(scriptId, markers);
    for (const [lineNumber, marker] of markers.entries()) {
      if (!markerNames.has(marker)) continue;
      await client.setBreakpoint(scriptId, lineNumber, 0);
    }
  }
}

liveTest(
  "debugger captures tool start/end hooks",
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
      inspector: true,
      debugActivity: true,
      testHooks: true,
    });
    assert.ok(server.inspectorPort, "Inspector port missing");
    const tmux = await startTmuxSession();
    const debugEnv = process.env.CODEX_DEBUG_ENV ?? "RUST_LOG=debug";

    const client = await CdpClient.connect(server.inspectorPort!);
    const markerIndex: MarkerIndex = new Map();
    const scripts: ScriptIndex = new Map();

    client.on("Debugger.scriptParsed", (event: { scriptId: string; url?: string }) => {
      if (!event.url) return;
      scripts.set(event.scriptId, event.url);
      if (!event.url.includes("codexLogs.ts") && !event.url.includes("scan.ts")) return;
      void (async () => {
        const source = await client.getScriptSource(event.scriptId);
        const markers = buildMarkerIndex(source);
        if (markers.size > 0) {
          markerIndex.set(event.scriptId, markers);
        }
      })();
    });

    await client.enable();

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

      const ready = await waitForCodexReady(tmux, 20_000);
      if (ready.status === "auth") {
        const excerpt = formatPaneExcerpt(ready.output);
        const suffix = excerpt ? `\nTmux output:\n${excerpt}` : "";
        t.skip(`codex auth required in this environment${suffix}`);
        return;
      }
      if (ready.status === "error") {
        const excerpt = formatPaneExcerpt(ready.output);
        const suffix = excerpt ? `\nTmux output:\n${excerpt}` : "";
        t.skip(`codex failed to start${suffix}`);
        return;
      }

      await tmux.sendText(`Run bash: sleep 5. Tag: ${testTag}`);

      try {
        await waitForSessionFile(codexHome.home, 30_000, startAt);
        const panePid = await tmux.panePid();
        await waitForCodexPid({ startAfterMs: startAt, timeoutMs: 10_000, panePid });
      } catch (err) {
        const paneOutput = await tmux.capture();
        const excerpt = formatPaneExcerpt(paneOutput);
        const suffix = excerpt ? `\nTmux output:\n${excerpt}` : "";
        t.skip(`codex did not start session or pid: ${String(err)}${suffix}`);
        return;
      }
      await waitForScripts(scripts, 10_000);
      await setMarkerBreakpoints(
        client,
        scripts,
        markerIndex,
        new Set([
          "TEST_HOOK_TOOL_START",
          "TEST_HOOK_TOOL_END",
          "TEST_HOOK_WORK_START",
          "TEST_HOOK_WORK_END",
        ])
      );

      const expectedStart = new Set(["TEST_HOOK_TOOL_START", "TEST_HOOK_WORK_START"]);
      const expectedEnd = new Set(["TEST_HOOK_TOOL_END", "TEST_HOOK_WORK_END"]);
      const observations: Array<{ marker: string; openCallCount: number; inFlight: boolean }> = [];
      const start = Date.now();

      let sawStart = false;
      let sawEnd = false;
      while ((!sawStart || !sawEnd) && Date.now() - start < 120_000) {
        const paused = await client.waitForPaused(60_000);
        if (!paused) break;
        const frame = paused.callFrames[0];
        const marker = await markerForFrame(
          client,
          markerIndex,
          frame.location.scriptId,
          frame.location.lineNumber
        );
        if (marker && (marker.includes("_START") || marker.includes("_END"))) {
          const evalResult = await client.evaluateOnCallFrame(
            frame.callFrameId,
            "({ inFlight: state.inFlight, openCallCount: state.openCallIds ? state.openCallIds.size : 0 })"
          );
          const value = evalResult?.result?.value;
          observations.push({
            marker,
            openCallCount: value?.openCallCount ?? 0,
            inFlight: value?.inFlight ?? false,
          });
          if (expectedStart.has(marker)) sawStart = true;
          if (expectedEnd.has(marker)) sawEnd = true;
        }
        await client.resume();
      }

      assert.ok(sawStart, "Did not observe work start marker");
      assert.ok(sawEnd, "Did not observe work end marker");

      const startObs = observations.find((obs) => obs.marker.includes("_START"));
      const endObs = observations.find((obs) => obs.marker.includes("_END"));
      assert.ok(startObs, "Missing tool start observation");
      assert.ok(endObs, "Missing tool end observation");
      assert.ok(startObs.inFlight, "inFlight should be true at tool start");
      assert.ok(startObs.openCallCount >= 1, "openCallCount should be >=1 at tool start");
      assert.ok(
        endObs.openCallCount <= startObs.openCallCount,
        "openCallCount should not increase at tool end"
      );
    } finally {
      client.close();
      await tmux.kill();
      await server.stop();
      await project.cleanup();
      await codexHome.cleanup();
    }
  }
);
