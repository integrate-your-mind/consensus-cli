import type { AgentSnapshot, AgentState } from '../types';
import { agentIdentity } from './format';
import { isServerKind } from './palette';

const STATE_RANK: Record<AgentState, number> = {
  error: 3,
  active: 2,
  idle: 1,
};

function pickBetterAgent(a: AgentSnapshot, b: AgentSnapshot): AgentSnapshot {
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
    const identity = agentIdentity(agent) || `${agent.pid}`;
    const scope = isServerKind(agent.kind) ? 'server' : 'agent';
    const key = `${scope}:${identity}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, agent);
      continue;
    }
    byKey.set(key, pickBetterAgent(existing, agent));
  }
  return [...byKey.values()];
}

export function normalizeState(value: unknown): AgentState {
  if (typeof value !== 'string') return 'idle';
  const state = value.trim().toLowerCase();
  if (state === 'active' || state === 'idle' || state === 'error') return state;
  return 'idle';
}

export function normalizeAgents(agents: AgentSnapshot[]): AgentSnapshot[] {
  return dedupeAgents(agents).map((agent) => ({
    ...agent,
    state: normalizeState(agent.state),
  }));
}

export function isActiveSession(agent: AgentSnapshot): boolean {
  return agent.state === 'active' || agent.state === 'error';
}

export function filterActiveSessions(agents: AgentSnapshot[]): AgentSnapshot[] {
  return agents.filter((agent) => isActiveSession(agent));
}

function activityTimestamp(agent: AgentSnapshot): number {
  if (typeof agent.lastActivityAt === 'number') return agent.lastActivityAt;
  if (typeof agent.lastEventAt === 'number') return agent.lastEventAt;
  if (typeof agent.startedAt === 'number') return agent.startedAt;
  return 0;
}

function compareByActivity(a: AgentSnapshot, b: AgentSnapshot): number {
  const aTs = activityTimestamp(a);
  const bTs = activityTimestamp(b);
  if (aTs !== bTs) return bTs - aTs;
  return agentIdentity(a).localeCompare(agentIdentity(b));
}

export function splitAgentsByActivity(agents: AgentSnapshot[]): {
  active: AgentSnapshot[];
  inactive: AgentSnapshot[];
} {
  const active: AgentSnapshot[] = [];
  const inactive: AgentSnapshot[] = [];
  for (const agent of agents) {
    if (isActiveSession(agent)) {
      active.push(agent);
    } else {
      inactive.push(agent);
    }
  }
  active.sort(compareByActivity);
  inactive.sort(compareByActivity);
  return { active, inactive };
}

export function sortAgentsForLane(agents: AgentSnapshot[]): AgentSnapshot[] {
  const { active, inactive } = splitAgentsByActivity(agents);
  return [...active, ...inactive];
}
