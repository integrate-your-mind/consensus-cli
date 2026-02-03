import { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import type { AgentSnapshot, ViewState } from '../types';
import { useCanvasRenderer } from '../hooks/useCanvasRenderer';
import { createLayoutState, updateLayout } from '../lib/layout';
import { agentIdentity } from '../lib/format';
import { Tooltip } from './Tooltip';

interface CanvasSceneProps {
  agents: AgentSnapshot[];
  view: ViewState;
  selected: AgentSnapshot | null;
  searchMatches: Set<string>;
  onSelect: (agent: AgentSnapshot | null) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
}

export function CanvasScene({
  agents,
  view,
  selected,
  searchMatches: _searchMatches,
  onSelect,
  onMouseDown,
  onKeyDown,
  onWheel,
}: CanvasSceneProps) {
  const layoutRef = useRef(createLayoutState());
  const spawnTimesRef = useRef<Map<string, number>>(new Map());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [hovered, setHovered] = useState<AgentSnapshot | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const { canvasRef, startRender, stopRender, getAgentAtPoint, getHitList } = useCanvasRenderer();

  // Update layout and spawn times when agents change
  useLayoutEffect(() => {
    const nextIds = new Set<string>();
    const now = Date.now();

    for (const agent of agents) {
      const id = agentIdentity(agent);
      nextIds.add(id);
      if (!knownIdsRef.current.has(id)) {
        spawnTimesRef.current.set(id, now);
      }
    }

    for (const id of knownIdsRef.current) {
      if (!nextIds.has(id)) {
        spawnTimesRef.current.delete(id);
      }
    }

    knownIdsRef.current = nextIds;
    updateLayout(layoutRef.current, agents);
  }, [agents]);

  useEffect(() => {
    const win = window as any;
    if (!win.__consensusMock) {
      win.__consensusMock = {};
    }
    win.__consensusMock.getHitList = () => getHitList();
    win.__consensusMock.getView = () => ({ x: view.x, y: view.y, scale: view.scale });
  }, [view, getHitList]);

  useEffect(() => {
    startRender(view, agents, {
      layout: layoutRef.current,
      hovered,
      selected,
      spawnTimes: spawnTimesRef.current,
      deviceScale: window.devicePixelRatio || 1,
    });
  }, [agents, view, hovered, selected, startRender]);

  useEffect(() => {
    return () => {
      stopRender();
    };
  }, [stopRender]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const found = getAgentAtPoint(e.clientX, e.clientY);
    setHovered(found);
    setTooltipPos({ x: e.clientX + 12, y: e.clientY + 12 });
  }, [getAgentAtPoint]);

  const handleMouseLeave = useCallback(() => {
    setHovered(null);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // First try hovered state, otherwise calculate from click position
    if (hovered) {
      onSelect(hovered);
      return;
    }
    
    const found = getAgentAtPoint(e.clientX, e.clientY);
    if (found) {
      onSelect(found);
    }
  }, [hovered, onSelect, getAgentAtPoint]);

  return (
    <div className="canvas-container">
      <canvas
        id="scene"
        ref={canvasRef}
        role="img"
        aria-label="Codex process map"
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
      />
      <Tooltip agent={hovered} x={tooltipPos.x} y={tooltipPos.y} />
    </div>
  );
}
