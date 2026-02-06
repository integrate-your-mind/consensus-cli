import nodePath from "node:path";

export type SessionFile = {
  path: string;
  mtimeMs: number;
};

export type CodexSessionSelection = {
  session?: SessionFile;
  source:
    | "sessionId"
    | "findSessionById"
    | "mapped"
    | "cwd"
    | "cwd-preferred"
    | "cwd-alternate"
    | "cwd-fallback"
    | "pinned"
    | "none";
  reuseBlocked: boolean;
  pinnedPath?: string;
};

const normalizeSessionPath = (value?: string): string | undefined =>
  value ? nodePath.resolve(value) : undefined;

export function shouldDropPinnedSessionByMtime(input: {
  now: number;
  mtimeMs: number;
  staleFileMs: number;
}): boolean {
  const { now, mtimeMs, staleFileMs } = input;
  if (!Number.isFinite(staleFileMs) || staleFileMs <= 0) return false;
  return now - mtimeMs > staleFileMs;
}

export function deriveCodexSessionIdentity(input: {
  pid: number;
  reuseBlocked: boolean;
  sessionId?: string;
  sessionPath?: string;
}): string {
  if (input.reuseBlocked) return `pid:${input.pid}`;
  if (input.sessionId) return `codex:${input.sessionId}`;
  if (input.sessionPath) return `codex:${input.sessionPath}`;
  return `pid:${input.pid}`;
}

export function selectCodexSessionForProcess(input: {
  cmdRaw: string;
  sessionId?: string;
  sessionFromId?: SessionFile;
  sessionFromFind?: SessionFile;
  mappedSession?: SessionFile;
  cwdSession?: SessionFile;
  cachedSession?: SessionFile;
  usedSessionPaths: Set<string>;
}): CodexSessionSelection {
  const sessionFromId: SessionFile | undefined = input.sessionFromId;
  const sessionFromFind: SessionFile | undefined = input.sessionFromFind;
  const sessionFromMapped: SessionFile | undefined = input.mappedSession;
  const sessionFromCwd: SessionFile | undefined = input.cwdSession;
  const sessionFromCache: SessionFile | undefined = input.cachedSession;

  const explicitSession =
    sessionFromId || sessionFromFind || sessionFromMapped || sessionFromCwd;

  let session = explicitSession || sessionFromCache;
  let source: CodexSessionSelection["source"] = "none";
  if (sessionFromId) source = "sessionId";
  else if (sessionFromFind) source = "findSessionById";
  else if (sessionFromMapped) source = "mapped";
  else if (sessionFromCwd) source = "cwd";
  else if (sessionFromCache) source = "pinned";

  const chosenPath = normalizeSessionPath(session?.path);
  const cachedPath = normalizeSessionPath(sessionFromCache?.path);
  const pinnedPath =
    cachedPath && chosenPath && cachedPath === chosenPath ? cachedPath : undefined;
  const hasPinnedSession = !!pinnedPath;

  if (!hasPinnedSession && sessionFromCwd && sessionFromMapped) {
    const mappedMtime = sessionFromMapped.mtimeMs ?? 0;
    const cwdMtime = sessionFromCwd.mtimeMs ?? 0;
    if (cwdMtime > mappedMtime + 1000) {
      session = sessionFromCwd;
      source = "cwd-preferred";
    }
  }

  // If we have an explicit session signal (id/mapped/cwd) avoid treating the cached path
  // as authoritative unless it's already the chosen path.
  const allowReuse = !!input.sessionId || /\bresume\b/i.test(input.cmdRaw);
  const allowReusePinned = allowReuse || hasPinnedSession;
  const initialSessionPath = normalizeSessionPath(session?.path);

  let reuseBlocked = false;
  if (
    initialSessionPath &&
    input.usedSessionPaths.has(initialSessionPath) &&
    !allowReusePinned
  ) {
    const alternatePath = sessionFromCwd
      ? normalizeSessionPath(sessionFromCwd.path)
      : undefined;
    if (sessionFromCwd && alternatePath && alternatePath !== initialSessionPath) {
      session = sessionFromCwd;
      source = "cwd-alternate";
    } else {
      reuseBlocked = true;
    }
  }

  if (!session) {
    session = sessionFromCwd;
    reuseBlocked = false;
    if (session) source = "cwd-fallback";
  }

  return {
    session,
    source,
    reuseBlocked,
    pinnedPath,
  };
}
