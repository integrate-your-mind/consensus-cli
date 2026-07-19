import type { AgentSnapshot, AgentKind, AgentState } from "./types.js";

const STATE_RANK: Record<AgentState, number> = {
  error: 3,
  active: 2,
  idle: 1,
};

const isDebugDedupe = () => process.env.CONSENSUS_DEBUG_DEDUPE === "1";

function logDedupe(message: string): void {
  if (!isDebugDedupe()) return;
  process.stderr.write(`[consensus][dedupe] ${Date.now()} ${message}\n`);
}

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

function pickReason(a: AgentSnapshot, b: AgentSnapshot): string {
  const rankA = STATE_RANK[a.state] ?? 0;
  const rankB = STATE_RANK[b.state] ?? 0;
  if (rankA !== rankB) return "state";
  const eventA = a.lastEventAt ?? 0;
  const eventB = b.lastEventAt ?? 0;
  if (eventA !== eventB) return "lastEventAt";
  if (a.cpu !== b.cpu) return "cpu";
  if (a.mem !== b.mem) return "mem";
  const startA = a.startedAt ?? 0;
  const startB = b.startedAt ?? 0;
  if (startA !== startB) return "startedAt";
  return "tie";
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
    const winner = pickBetter(existing, agent);
    if (isDebugDedupe()) {
      const reason = pickReason(existing, agent);
      const left = `${existing.identity ?? existing.sessionPath ?? `pid:${existing.pid}`}`;
      const right = `${agent.identity ?? agent.sessionPath ?? `pid:${agent.pid}`}`;
      const kept = winner === existing ? left : right;
      const dropped = winner === existing ? right : left;
      logDedupe(
        `key=${key} reason=${reason} kept=${kept} dropped=${dropped} ` +
          `states=${existing.state}/${agent.state} ` +
          `eventAt=${existing.lastEventAt ?? "?"}/${agent.lastEventAt ?? "?"} ` +
          `activityAt=${existing.lastActivityAt ?? "?"}/${agent.lastActivityAt ?? "?"}`
      );
    }
    byKey.set(key, winner);
  }
  return [...byKey.values()];
}
