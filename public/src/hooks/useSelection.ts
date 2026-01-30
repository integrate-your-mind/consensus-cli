import { useState, useCallback } from 'react';
import type { AgentSnapshot } from '../types';
import { agentIdentity } from '../lib/format';

export function useSelection(agents: AgentSnapshot[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = agents.find((a) => agentIdentity(a) === selectedId) || null;

  const select = useCallback((agent: AgentSnapshot | null) => {
    setSelectedId(agent ? agentIdentity(agent) : null);
  }, []);

  const selectById = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const deselect = useCallback(() => {
    setSelectedId(null);
  }, []);

  const isSelected = useCallback((agent: AgentSnapshot) => {
    return agentIdentity(agent) === selectedId;
  }, [selectedId]);

  return {
    selected,
    selectedId,
    select,
    selectById,
    deselect,
    isSelected,
  };
}
