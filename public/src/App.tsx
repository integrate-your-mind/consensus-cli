import { useMemo, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useViewState } from './hooks/useViewState';
import { useSearch } from './hooks/useSearch';
import { useSelection } from './hooks/useSelection';
import { HUD } from './components/HUD';
import { CanvasScene } from './components/CanvasScene';
import { AgentLane } from './components/AgentLane';
import { AgentPanel } from './components/AgentPanel';
import { isServerKind } from './lib/palette';
import { initMockBridge } from './lib/mockBridge';

// Parse URL params
const query = new URLSearchParams(window.location.search);
const mockMode = query.get('mock') === '1';
const wsOverrideRaw = query.get('ws');
const wsOverrideDecoded = wsOverrideRaw ? decodeURIComponent(wsOverrideRaw) : null;

let wsOverride: string | null = null;
if (wsOverrideDecoded) {
  if (wsOverrideDecoded.startsWith('ws://') || wsOverrideDecoded.startsWith('wss://')) {
    wsOverride = wsOverrideDecoded;
  } else if (wsOverrideDecoded.startsWith('http://') || wsOverrideDecoded.startsWith('https://')) {
    wsOverride = wsOverrideDecoded.replace(/^http/, 'ws');
  }
}

if (mockMode) {
  initMockBridge();
}

if (wsOverrideRaw || mockMode) {
  (window as any).__consensusDebug = {
    wsOverride,
    wsOverrideRaw,
    search: window.location.search,
  };
}

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = wsOverride || `${wsProtocol}://${window.location.host}/ws`;

function App() {
  const { status, agents, meta } = useWebSocket(wsUrl, { mockMode });
  const [view, , , viewHandlers] = useViewState();
  const { query: searchQuery, setQuery, matches, filteredAgents } = useSearch(agents);
  const { selected, selectedId, select, deselect } = useSelection(agents);

  const agentCount = useMemo(() => {
    return filteredAgents.filter((a) => !isServerKind(a.kind)).length;
  }, [filteredAgents]);

  const serverCount = useMemo(() => {
    return filteredAgents.filter((a) => isServerKind(a.kind)).length;
  }, [filteredAgents]);

  const displayAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    return filteredAgents;
  }, [agents, filteredAgents, searchQuery]);

  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
  }, [setQuery]);

  return (
    <main id="main">
      <CanvasScene
        agents={displayAgents}
        view={view}
        selected={selected}
        searchMatches={matches}
        onSelect={select}
        onMouseDown={viewHandlers.onMouseDown}
        onKeyDown={viewHandlers.onKeyDown}
        onCanvasWheel={viewHandlers.onCanvasWheel}
      />
      
      <HUD
        status={status}
        agentCount={agentCount}
        serverCount={serverCount}
        meta={meta}
      />
      
      <AgentLane
        agents={displayAgents}
        selectedId={selectedId}
        searchQuery={searchQuery}
        onSelect={select}
        onSearchChange={handleSearchChange}
      />
      
      <AgentPanel
        agent={selected}
        showMetadata={searchQuery.trim().length > 0}
        onClose={deselect}
      />
    </main>
  );
}

export default App;
