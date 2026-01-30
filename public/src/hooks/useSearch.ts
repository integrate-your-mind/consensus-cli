import { useState, useMemo, useCallback } from 'react';
import type { AgentSnapshot } from '../types';
import { agentIdentity } from '../lib/format';

export function matchesQuery(agent: AgentSnapshot, query: string): boolean {
  const haystack = [
    agent.pid,
    agent.title,
    agent.summary?.current,
    agent.summary?.lastCommand,
    agent.summary?.lastEdit,
    agent.summary?.lastMessage,
    agent.summary?.lastTool,
    agent.summary?.lastPrompt,
    agent.lastEventAt,
    agent.cmd,
    agent.cwd,
    agent.sessionPath,
    agent.model,
    agent.repo,
    agent.kind,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');
  
  return haystack.includes(query.toLowerCase());
}

export function useSearch(agents: AgentSnapshot[]) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return new Set<string>();
    
    return new Set(
      agents
        .filter((agent) => matchesQuery(agent, normalizedQuery))
        .map((agent) => agentIdentity(agent))
    );
  }, [agents, query]);

  const filteredAgents = useMemo(() => {
    if (!query.trim()) return agents;
    return agents.filter((agent) => matches.has(agentIdentity(agent)));
  }, [agents, matches, query]);

  const clearSearch = useCallback(() => {
    setQuery('');
  }, []);

  return {
    query,
    setQuery,
    matches,
    filteredAgents,
    clearSearch,
    isActive: query.trim().length > 0,
  };
}
