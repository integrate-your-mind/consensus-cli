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

export const getOpenCodeSessionParentId = (session: unknown): string | undefined => {
  if (!session || typeof session !== "object") return undefined;
  const target = session as { parentID?: unknown; parentId?: unknown; parent_id?: unknown };
  const raw = target.parentID ?? target.parentId ?? target.parent_id;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
};

export const isOpenCodeChildSession = (session: unknown): boolean => {
  return typeof getOpenCodeSessionParentId(session) === "string";
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
  childSessionIds,
}: {
  dir?: string;
  sessionsByDir: Map<string, T[]>;
  activeSessionIdsByDir: Map<string, string[]>;
  sessionsById: Map<string, T>;
  usedSessionIds: UsedSessionMap;
  pid: number;
  childSessionIds?: Set<string>;
}): T | undefined => {
  if (!dir) return undefined;
  const sessions = sessionsByDir.get(dir);
  if (!sessions || sessions.length === 0) return undefined;
  const activeIds = activeSessionIdsByDir.get(dir);
  const isChildId = (id: string): boolean => !!childSessionIds?.has(id);
  if (activeIds) {
    for (const id of activeIds) {
      if (isChildId(id)) continue;
      const activeSession = sessionsById.get(id);
      if (activeSession && isOpenCodeChildSession(activeSession)) continue;
      if (!markOpenCodeSessionUsed(usedSessionIds, id, pid)) continue;
      if (activeSession) return activeSession;
      // If API no longer lists this session, keep id reserved to avoid collisions.
      return undefined;
    }
  }
  for (const session of sessions) {
    if (isOpenCodeChildSession(session)) continue;
    const id = getOpenCodeSessionId(session);
    if (!id) continue;
    if (isChildId(id)) continue;
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
  childSessionIds,
}: {
  pid: number;
  dir?: string;
  sessionByPid?: T;
  cachedSessionId?: string;
  sessionsById: Map<string, T>;
  sessionsByDir: Map<string, T[]>;
  activeSessionIdsByDir: Map<string, string[]>;
  usedSessionIds: UsedSessionMap;
  childSessionIds?: Set<string>;
}): { session?: T; sessionId?: string; source: "pid" | "cache" | "dir" | "none" } => {
  const sessionByPidId = getOpenCodeSessionId(sessionByPid);
  if (
    sessionByPidId &&
    !isOpenCodeChildSession(sessionByPid) &&
    !childSessionIds?.has(sessionByPidId) &&
    markOpenCodeSessionUsed(usedSessionIds, sessionByPidId, pid)
  ) {
    return { session: sessionByPid, sessionId: sessionByPidId, source: "pid" };
  }

  if (cachedSessionId && !childSessionIds?.has(cachedSessionId)) {
    const cachedSession = sessionsById.get(cachedSessionId);
    if (
      !isOpenCodeChildSession(cachedSession) &&
      markOpenCodeSessionUsed(usedSessionIds, cachedSessionId, pid)
    ) {
      return {
        session: cachedSession,
        sessionId: cachedSessionId,
        source: "cache",
      };
    }
  }

  const byDir = pickOpenCodeSessionByDir({
    dir,
    sessionsByDir,
    activeSessionIdsByDir,
    sessionsById,
    usedSessionIds,
    pid,
    childSessionIds,
  });
  if (byDir) {
    return { session: byDir, sessionId: getOpenCodeSessionId(byDir), source: "dir" };
  }

  return { session: undefined, sessionId: undefined, source: "none" };
};
