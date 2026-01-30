import test from "node:test";
import assert from "node:assert/strict";
import {
  markOpenCodeSessionUsed,
  pickOpenCodeSessionByDir,
  selectOpenCodeSessionForTui,
} from "../../src/opencodeSessionAssign.ts";

type Session = { id: string; directory?: string; cwd?: string };

const makeSession = (id: string, dir = "/repo"): Session => ({ id, directory: dir });

test("markOpenCodeSessionUsed blocks collisions across pids", () => {
  const used = new Map<string, number>();
  assert.equal(markOpenCodeSessionUsed(used, "s1", 10), true);
  assert.equal(used.get("s1"), 10);
  assert.equal(markOpenCodeSessionUsed(used, "s1", 10), true);
  assert.equal(markOpenCodeSessionUsed(used, "s1", 20), false);
  assert.equal(used.get("s1"), 10);
});

test("selectOpenCodeSessionForTui prefers pid-matched session", () => {
  const used = new Map<string, number>();
  const sessionsById = new Map<string, Session>([["s1", makeSession("s1")]]);
  const sessionsByDir = new Map<string, Session[]>();
  const activeByDir = new Map<string, string[]>();

  const result = selectOpenCodeSessionForTui({
    pid: 101,
    dir: "/repo",
    sessionByPid: makeSession("s1"),
    cachedSessionId: "s2",
    sessionsById,
    sessionsByDir,
    activeSessionIdsByDir: activeByDir,
    usedSessionIds: used,
  });

  assert.equal(result.sessionId, "s1");
  assert.equal(result.source, "pid");
  assert.equal(used.get("s1"), 101);
});

test("selectOpenCodeSessionForTui skips pid session when already used", () => {
  const used = new Map<string, number>([["s1", 999]]);
  const sessionsById = new Map<string, Session>([["s2", makeSession("s2")]]);
  const sessionsByDir = new Map<string, Session[]>();
  const activeByDir = new Map<string, string[]>();

  const result = selectOpenCodeSessionForTui({
    pid: 202,
    dir: "/repo",
    sessionByPid: makeSession("s1"),
    cachedSessionId: "s2",
    sessionsById,
    sessionsByDir,
    activeSessionIdsByDir: activeByDir,
    usedSessionIds: used,
  });

  assert.equal(result.sessionId, "s2");
  assert.equal(result.source, "cache");
  assert.equal(used.get("s2"), 202);
});

test("selectOpenCodeSessionForTui preserves cached id even when session is missing", () => {
  const used = new Map<string, number>();
  const sessionsById = new Map<string, Session>();
  const sessionsByDir = new Map<string, Session[]>();
  const activeByDir = new Map<string, string[]>();

  const result = selectOpenCodeSessionForTui({
    pid: 303,
    dir: "/repo",
    cachedSessionId: "s-cache",
    sessionsById,
    sessionsByDir,
    activeSessionIdsByDir: activeByDir,
    usedSessionIds: used,
  });

  assert.equal(result.sessionId, "s-cache");
  assert.equal(result.source, "cache");
  assert.equal(result.session, undefined);
  assert.equal(used.get("s-cache"), 303);
});

test("pickOpenCodeSessionByDir prefers active ids and avoids collisions", () => {
  const used = new Map<string, number>([["s2", 777]]);
  const sessionsById = new Map<string, Session>([
    ["s1", makeSession("s1")],
    ["s2", makeSession("s2")],
  ]);
  const sessionsByDir = new Map<string, Session[]>([["/repo", [makeSession("s1"), makeSession("s2")]]]);
  const activeByDir = new Map<string, string[]>([["/repo", ["s2", "s1"]]]);

  const picked = pickOpenCodeSessionByDir({
    dir: "/repo",
    sessionsByDir,
    activeSessionIdsByDir: activeByDir,
    sessionsById,
    usedSessionIds: used,
    pid: 808,
  });

  assert.equal(picked?.id, "s1");
  assert.equal(used.get("s1"), 808);
  assert.equal(used.get("s2"), 777);
});

test("selectOpenCodeSessionForTui keeps stable mapping across multiple pids", () => {
  const used = new Map<string, number>();
  const sessionsById = new Map<string, Session>([
    ["s1", makeSession("s1")],
    ["s2", makeSession("s2")],
  ]);
  const sessionsByDir = new Map<string, Session[]>([["/repo", [makeSession("s1"), makeSession("s2")]]]);
  const activeByDir = new Map<string, string[]>([["/repo", ["s1", "s2"]]]);

  const first = selectOpenCodeSessionForTui({
    pid: 1,
    dir: "/repo",
    cachedSessionId: "s1",
    sessionsById,
    sessionsByDir,
    activeSessionIdsByDir: activeByDir,
    usedSessionIds: used,
  });
  const second = selectOpenCodeSessionForTui({
    pid: 2,
    dir: "/repo",
    cachedSessionId: "s2",
    sessionsById,
    sessionsByDir,
    activeSessionIdsByDir: activeByDir,
    usedSessionIds: used,
  });

  assert.equal(first.sessionId, "s1");
  assert.equal(second.sessionId, "s2");
  assert.equal(used.get("s1"), 1);
  assert.equal(used.get("s2"), 2);
});
