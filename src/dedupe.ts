import type { AgentSnapshot, AgentKind, AgentState } from "./types.js";

const STATE_RANK: Record<AgentState, number> = {
  error: 3,
  active: 2,
  idle: 1,
};

function isServerKind(kind: AgentKind): boolean {
  return kind.endsWith("server") || kind === "app-server";
}

function identityForAgent(agent: AgentSnapshot): string {
  const base = agent.identity || agent.sessionPath;
  if (!isServerKind(agent.kind)) {
    if (base) return `agent:${base}`;
    return `agent:pid:${agent.pid}`;
  }
  return `server:${base || `pid:${agent.pid}`}`;
}

function pickBetter(a: AgentSnapshot, b: AgentSnapshot): AgentSnapshot {
  const rankA = STATE_RANK[a.state] ?? 0;
  const rankB = STATE_RANK[b.state] ?? 0;
  if (rankA !== rankB) return rankA > rankB ? a : b;

  const eventA = a.lastEventAt ?? 0;
  const eventB = b.lastEventAt ?? 0;
  if (eventA !== eventB) return eventA > eventB ? a : b;

  if (a.cpu !== b.cpu) return a.cpu > b.cpu ? a : b;
  if (a.mem !== b.mem) return a.mem > b.mem ? a : b;

  const startA = a.startedAt ?? 0;
  const startB = b.startedAt ?? 0;
  if (startA !== startB) return startA > startB ? a : b;

  return a;
}

export function dedupeAgents(agents: AgentSnapshot[]): AgentSnapshot[] {
  const byKey = new Map<string, AgentSnapshot>();
  for (const agent of agents) {
    const key = identityForAgent(agent);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, agent);
      continue;
    }
    byKey.set(key, pickBetter(existing, agent));
  }
  return [...byKey.values()];
}
