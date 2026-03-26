import type { AgentSnapshot, WsStatus } from '../types';
import { isServerKind } from '../lib/palette';
import { agentIdentity } from '../lib/format';
import { sortAgentsForLane } from '../lib/agents';
import { AgentListItem } from './AgentListItem';

const SKELETON_COUNT = 3;

interface AgentLaneProps {
  agents: AgentSnapshot[];
  status: WsStatus;
  selectedId: string | null;
  searchQuery: string;
  onSelect: (agent: AgentSnapshot) => void;
  onSearchChange: (query: string) => void;
}

export function AgentLane({
  agents,
  status,
  selectedId,
  searchQuery,
  onSelect,
  onSearchChange,
}: AgentLaneProps) {
  const agentNodes = sortAgentsForLane(
    agents.filter((agent) => !isServerKind(agent.kind))
  );
  const serverNodes = sortAgentsForLane(
    agents.filter((agent) => isServerKind(agent.kind))
  );
  const visibleAgents = agentNodes;
  const visibleServers = serverNodes;
  const isLoading = (status === 'connecting') && agentNodes.length === 0;

  const agentTitle = searchQuery ? 'search results' : 'agents';
  const serverTitle = searchQuery ? 'server results' : 'servers';

  return (
    <div id="active-lane" role="region" aria-label="Agents">
      <div className="lane-title">{agentTitle}</div>
      <input
        id="search"
        type="search"
        placeholder="Search metadata…"
        aria-label="Search metadata"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      
      <div id="active-list">
        {isLoading ? (
          Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div key={i} className="lane-item is-skeleton" aria-hidden="true">
              <div className="lane-pill idle" />
              <div className="lane-copy">
                <div className="lane-label lane-skel" />
                <div className="lane-meta lane-skel lane-skel-short" />
              </div>
            </div>
          ))
        ) : visibleAgents.length === 0 ? (
          <div className="lane-meta">No agents detected.</div>
        ) : (
          visibleAgents.map((agent) => (
            <AgentListItem
              key={agentIdentity(agent)}
              agent={agent}
              isSelected={agentIdentity(agent) === selectedId}
              onClick={() => onSelect(agent)}
            />
          ))
        )}
      </div>

      <div className="lane-divider" aria-hidden="true" />
      <div className="lane-title server-title">{serverTitle}</div>
      
      <div id="server-list">
        {visibleServers.length === 0 ? (
          <div className="lane-meta">No servers detected.</div>
        ) : (
          visibleServers.map((agent) => (
            <AgentListItem
              key={agentIdentity(agent)}
              agent={agent}
              isSelected={agentIdentity(agent) === selectedId}
              onClick={() => onSelect(agent)}
            />
          ))
        )}
      </div>
    </div>
  );
}
