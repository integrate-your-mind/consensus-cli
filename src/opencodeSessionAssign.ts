export type OpenCodeSessionLike = {
  id?: string;
  sessionId?: string;
  sessionID?: string;
  session_id?: string;
  info?: { id?: string };
  pid?: number;
  processId?: number;
  processID?: number;
  process?: { pid?: number; processId?: number; processID?: number };
  directory?: string;
  cwd?: string;
  title?: unknown;
  name?: unknown;
  lastActivity?: unknown;
  lastActivityAt?: unknown;
  time?: unknown;
  updatedAt?: unknown;
  updated?: unknown;
  createdAt?: unknown;
  created?: unknown;
  status?: unknown;
  model?: unknown;
};

type UsedSessionMap = Map<string, number>;

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
};

export const getOpenCodeSessionId = (session: unknown): string | undefined => {
  if (!session || typeof session !== "object") return undefined;
  const target = session as OpenCodeSessionLike;
  const raw =
    target.id ||
    target.sessionId ||
    target.sessionID ||
    target.session_id ||
    target.info?.id;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
};

export const getOpenCodeSessionPid = (session: unknown): number | undefined => {
  if (!session || typeof session !== "object") return undefined;
  const target = session as OpenCodeSessionLike;
  return coerceNumber(
    target.pid ??
      target.processId ??
      target.processID ??
      target.process?.pid ??
      target.process?.processId ??
      target.process?.processID
  );
};

export const isOpenCodeChildSession = (session: unknown): boolean => {
  if (!session || typeof session !== "object") return false;
  // Check for any parent indicator
  if ("parentId" in session && session.parentId) return true;
  if ("parentID" in session && session.parentID) return true;
  if ("parent_id" in session && session.parent_id) return true;
  return false;
};

export const markOpenCodeSessionUsed = (
  used: UsedSessionMap,
  sessionId: string,
  pid: number
): boolean => {
  const existing = used.get(sessionId);
  if (existing !== undefined && existing !== pid) return false;
  used.set(sessionId, pid);
  return true;
};

export const pickOpenCodeSessionByDir = <T extends OpenCodeSessionLike>({
  dir,
  sessionsByDir,
  activeSessionIdsByDir,
  sessionsById,
  usedSessionIds,
  pid,
}: {
  dir?: string;
  sessionsByDir: Map<string, T[]>;
  activeSessionIdsByDir: Map<string, string[]>;
  sessionsById: Map<string, T>;
  usedSessionIds: UsedSessionMap;
  pid: number;
}): T | undefined => {
  if (!dir) return undefined;
  const sessions = sessionsByDir.get(dir);
  if (!sessions || sessions.length === 0) return undefined;
  const activeIds = activeSessionIdsByDir.get(dir);
  if (activeIds) {
    for (const id of activeIds) {
      if (!markOpenCodeSessionUsed(usedSessionIds, id, pid)) continue;
      const activeSession = sessionsById.get(id);
      if (activeSession) return activeSession;
      // If API no longer lists this session, keep id reserved to avoid collisions.
      return undefined;
    }
  }
  for (const session of sessions) {
    const id = getOpenCodeSessionId(session);
    if (!id) continue;
    if (!markOpenCodeSessionUsed(usedSessionIds, id, pid)) continue;
    return session;
  }
  return undefined;
};

export const selectOpenCodeSessionForTui = <T extends OpenCodeSessionLike>({
  pid,
  dir,
  sessionByPid,
  cachedSessionId,
  sessionsById,
  sessionsByDir,
  activeSessionIdsByDir,
  usedSessionIds,
}: {
  pid: number;
  dir?: string;
  sessionByPid?: T;
  cachedSessionId?: string;
  sessionsById: Map<string, T>;
  sessionsByDir: Map<string, T[]>;
  activeSessionIdsByDir: Map<string, string[]>;
  usedSessionIds: UsedSessionMap;
}): { session?: T; sessionId?: string; source: "pid" | "cache" | "dir" | "none" } => {
  const sessionByPidId = getOpenCodeSessionId(sessionByPid);
  if (sessionByPidId && markOpenCodeSessionUsed(usedSessionIds, sessionByPidId, pid)) {
    return { session: sessionByPid, sessionId: sessionByPidId, source: "pid" };
  }

  if (cachedSessionId && markOpenCodeSessionUsed(usedSessionIds, cachedSessionId, pid)) {
    return {
      session: sessionsById.get(cachedSessionId),
      sessionId: cachedSessionId,
      source: "cache",
    };
  }

  const byDir = pickOpenCodeSessionByDir({
    dir,
    sessionsByDir,
    activeSessionIdsByDir,
    sessionsById,
    usedSessionIds,
    pid,
  });
  if (byDir) {
    return { session: byDir, sessionId: getOpenCodeSessionId(byDir), source: "dir" };
  }

  return { session: undefined, sessionId: undefined, source: "none" };
};
