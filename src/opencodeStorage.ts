import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

interface ProjectEntry {
  id: string;
  worktree?: string;
  time?: { created?: number; updated?: number };
}

interface SessionEntry {
  id: string;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}

const PROJECT_SCAN_INTERVAL_MS = 60_000;
const SESSION_SCAN_INTERVAL_MS = 5_000;

let projectCache: ProjectEntry[] = [];
let projectCacheAt = 0;
const sessionCache = new Map<string, { session?: SessionEntry; scannedAt: number }>();

export function resolveOpenCodeHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CONSENSUS_OPENCODE_HOME;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".local", "share", "opencode");
}

async function listProjectEntries(home: string): Promise<ProjectEntry[]> {
  const now = Date.now();
  if (now - projectCacheAt < PROJECT_SCAN_INTERVAL_MS) return projectCache;
  projectCacheAt = now;
  const projectDir = path.join(home, "storage", "project");
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(projectDir, { withFileTypes: true });
  } catch {
    projectCache = [];
    return projectCache;
  }
  const results: ProjectEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fullPath = path.join(projectDir, entry.name);
    try {
      const raw = await fsp.readFile(fullPath, "utf8");
      const data = JSON.parse(raw);
      results.push({
        id: data.id || entry.name.replace(/\.json$/, ""),
        worktree: data.worktree || data.directory,
        time: data.time,
      });
    } catch {
      continue;
    }
  }
  projectCache = results;
  return results;
}

function pickProjectId(projects: ProjectEntry[], cwd: string): string | undefined {
  const normalized = cwd.replace(/\\/g, "/");
  let best: ProjectEntry | undefined;
  for (const project of projects) {
    if (!project.worktree) continue;
    const projectPath = project.worktree.replace(/\\/g, "/");
    if (normalized === projectPath || normalized.startsWith(`${projectPath}/`)) {
      if (!best || (projectPath.length > (best.worktree?.length || 0))) {
        best = project;
      }
    }
  }
  return best?.id;
}

async function readLatestSessionForProject(home: string, projectId: string): Promise<SessionEntry | undefined> {
  const now = Date.now();
  const cached = sessionCache.get(projectId);
  if (cached && now - cached.scannedAt < SESSION_SCAN_INTERVAL_MS) {
    return cached.session;
  }
  const sessionDir = path.join(home, "storage", "session", projectId);
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(sessionDir, { withFileTypes: true });
  } catch {
    sessionCache.set(projectId, { session: undefined, scannedAt: now });
    return undefined;
  }
  let latestPath: string | null = null;
  let latestMtime = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("ses_") || !entry.name.endsWith(".json")) continue;
    const fullPath = path.join(sessionDir, entry.name);
    try {
      const stat = await fsp.stat(fullPath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestPath = fullPath;
      }
    } catch {
      continue;
    }
  }
  if (!latestPath) {
    sessionCache.set(projectId, { session: undefined, scannedAt: now });
    return undefined;
  }
  try {
    const raw = await fsp.readFile(latestPath, "utf8");
    const data = JSON.parse(raw);
    const session: SessionEntry = {
      id: data.id,
      title: data.title,
      directory: data.directory,
      time: data.time,
    };
    sessionCache.set(projectId, { session, scannedAt: now });
    return session;
  } catch {
    sessionCache.set(projectId, { session: undefined, scannedAt: now });
    return undefined;
  }
}

export async function getOpenCodeSessionForDirectory(
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<SessionEntry | undefined> {
  if (!cwd) return undefined;
  const home = resolveOpenCodeHome(env);
  const projects = await listProjectEntries(home);
  const projectId = pickProjectId(projects, cwd);
  if (!projectId) return undefined;
  return await readLatestSessionForProject(home, projectId);
}
