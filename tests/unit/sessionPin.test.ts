import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  deriveCodexSessionIdentity,
  selectCodexSessionForProcess,
  shouldDropPinnedSessionByMtime,
} from "../../src/codexSessionAssign.ts";

test("pinned session stays pinned across consecutive scan ticks", () => {
  const cachedSession = { path: "/tmp/codex-sessions/a/log.jsonl", mtimeMs: 1234 };
  const expectedPinned = path.resolve(cachedSession.path);

  for (let tick = 0; tick < 10; tick += 1) {
    const usedSessionPaths = new Set<string>();
    const selection = selectCodexSessionForProcess({
      cmdRaw: "codex",
      cachedSession,
      usedSessionPaths,
    });

    assert.equal(selection.session?.path, cachedSession.path);
    assert.equal(selection.pinnedPath, expectedPinned);
    assert.equal(selection.reuseBlocked, false);
  }
});

test("stale pinned session is dropped by mtime and a newer session can be selected", () => {
  const now = 10_000;
  const staleFileMs = 1000;
  const staleMtime = now - 2000;
  assert.equal(
    shouldDropPinnedSessionByMtime({ now, mtimeMs: staleMtime, staleFileMs }),
    true
  );

  const mappedSession = { path: "/tmp/codex-sessions/b/log.jsonl", mtimeMs: now };
  const selection = selectCodexSessionForProcess({
    cmdRaw: "codex",
    mappedSession,
    cachedSession: undefined,
    usedSessionPaths: new Set<string>(),
  });

  assert.equal(selection.session?.path, mappedSession.path);
  assert.equal(selection.pinnedPath, undefined);
  assert.equal(selection.reuseBlocked, false);
});

test("reuseBlocked prevents a second pid from claiming an already-used session path", () => {
  const shared = { path: "/tmp/codex-sessions/shared/log.jsonl", mtimeMs: 1 };
  const usedSessionPaths = new Set<string>([path.resolve(shared.path)]);

  const selection = selectCodexSessionForProcess({
    cmdRaw: "codex",
    mappedSession: shared,
    usedSessionPaths,
  });

  assert.equal(selection.session?.path, shared.path);
  assert.equal(selection.reuseBlocked, true);

  const identity = deriveCodexSessionIdentity({
    pid: 2000,
    reuseBlocked: selection.reuseBlocked,
    sessionId: undefined,
    sessionPath: shared.path,
  });
  assert.equal(identity, "pid:2000");
});

test("codex session identity is stable across ticks and falls back when session disappears", () => {
  const sessionPath = "/tmp/codex-sessions/a/log.jsonl";
  const identity1 = deriveCodexSessionIdentity({
    pid: 1000,
    reuseBlocked: false,
    sessionId: undefined,
    sessionPath,
  });
  const identity2 = deriveCodexSessionIdentity({
    pid: 1000,
    reuseBlocked: false,
    sessionId: undefined,
    sessionPath,
  });
  assert.equal(identity1, identity2);

  const identity3 = deriveCodexSessionIdentity({
    pid: 1000,
    reuseBlocked: false,
    sessionId: undefined,
    sessionPath: undefined,
  });
  assert.equal(identity3, "pid:1000");
});

