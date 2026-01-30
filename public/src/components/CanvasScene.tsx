import { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import type { AgentSnapshot, ViewState } from '../types';
import { useCanvasRenderer } from '../hooks/useCanvasRenderer';
import { createLayoutState, updateLayout, getCoordinate } from '../lib/layout';
import { agentIdentity, keyForAgent } from '../lib/format';
import { pointInDiamond, pointInQuad, isoToScreen } from '../lib/iso';
import { Tooltip } from './Tooltip';

const TILE_W = 96;
const TILE_H = 48;
const ROOF_SCALE = 0.28;
const ROOF_HIT_SCALE = 0.44;
const MARKER_SCALE = 0.36;
const MARKER_OFFSET = TILE_H * 0.6;

interface HitItem {
  x: number;
  y: number;
  roofY: number;
  roofW: number;
  roofH: number;
  roofHitW: number;
  roofHitH: number;
  height: number;
  agent: AgentSnapshot;
  key: string;
  markerY?: number;
}

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
  searchMatches,
  onSelect,
  onMouseDown,
  onKeyDown,
  onWheel,
}: CanvasSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(createLayoutState());
  const spawnTimesRef = useRef<Map<string, number>>(new Map());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [hovered, setHovered] = useState<AgentSnapshot | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hitListRef = useRef<HitItem[]>([]);

  const { canvasRef, startRender, stopRender } = useCanvasRenderer();

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

  // Rebuild hit list whenever agents or view changes
  useEffect(() => {
    const roofW = TILE_W * ROOF_SCALE;
    const roofH = roofW * 0.5;
    const roofHitW = TILE_W * ROOF_HIT_SCALE;
    const roofHitH = roofHitW * 0.5;

    // Sort by depth (same as render order)
    const sortedAgents = [...agents].sort((a, b) => {
      const coordA = getCoordinate(layoutRef.current, a) ?? { x: 0, y: 0 };
      const coordB = getCoordinate(layoutRef.current, b) ?? { x: 0, y: 0 };
      return coordA.x + coordA.y - (coordB.x + coordB.y);
    });

    const hitList: HitItem[] = [];

    for (const agent of sortedAgents) {
      const coord = getCoordinate(layoutRef.current, agent);
      if (!coord) continue;

      const screen = isoToScreen(coord.x, coord.y, TILE_W, TILE_H);
      const memMB = agent.mem / (1024 * 1024);
      const heightBase = Math.min(120, Math.max(18, memMB * 0.4));
      const idleScale = agent.state === 'idle' ? 0.6 : 1;
      const height = heightBase * idleScale;
      const roofY = screen.y - height - TILE_H * 0.15;

      hitList.push({
        x: screen.x,
        y: screen.y,
        roofY,
        roofW,
        roofH,
        roofHitW,
        roofHitH,
        height,
        agent,
        key: keyForAgent(agent),
      });
    }

    // Calculate obstruction and marker positions
    const obstructedIds = new Set<string>();
    for (const a of hitList) {
      const roofPoint = { x: a.x, y: a.roofY };
      for (const b of hitList) {
        if (a === b) continue;
        const topY = b.y - b.height;
        const halfW = TILE_W / 2;
        const halfH = TILE_H / 2;
        
        const leftA = { x: b.x - halfW, y: topY };
        const leftB = { x: b.x, y: topY + halfH };
        const leftC = { x: b.x, y: b.y + halfH };
        const leftD = { x: b.x - halfW, y: b.y };
        
        const rightA = { x: b.x + halfW, y: topY };
        const rightB = { x: b.x, y: topY + halfH };
        const rightC = { x: b.x, y: b.y + halfH };
        const rightD = { x: b.x + halfW, y: b.y };
        
        if (
          pointInQuad(roofPoint, leftA, leftB, leftC, leftD) ||
          pointInQuad(roofPoint, rightA, rightB, rightC, rightD)
        ) {
          obstructedIds.add(agentIdentity(a.agent));
          break;
        }
      }
    }

    for (const item of hitList) {
      if (obstructedIds.has(agentIdentity(item.agent))) {
        item.markerY = item.roofY - MARKER_OFFSET;
      }
    }

    hitListRef.current = hitList;
  }, [agents, view]);

  useEffect(() => {
    const win = window as any;
    if (!win.__consensusMock) {
      win.__consensusMock = {};
    }
    win.__consensusMock.getHitList = () => hitListRef.current;
    win.__consensusMock.getView = () => ({ x: view.x, y: view.y, scale: view.scale });
  }, [view]);

  // Start/stop render loop
  useEffect(() => {
    if (!canvasRef.current) return;
    
    startRender(view, agents, {
      layout: layoutRef.current,
      hovered,
      selected,
      spawnTimes: spawnTimesRef.current,
      deviceScale: window.devicePixelRatio || 1,
    });

    return () => {
      stopRender();
    };
  }, [agents, view, hovered, selected, searchMatches, startRender, stopRender, canvasRef]);

  const findAgentAt = useCallback((canvasX: number, canvasY: number): AgentSnapshot | null => {
    // Transform canvas coordinates to world coordinates
    const worldX = (canvasX - view.x) / view.scale;
    const worldY = (canvasY - view.y) / view.scale;

    const markerW = TILE_W * MARKER_SCALE;
    const markerH = markerW * 0.5;
    const hitList = hitListRef.current;

    if (!hitList.length) return null;

    // Check markers first (for obstructed agents)
    for (let i = hitList.length - 1; i >= 0; i--) {
      const item = hitList[i];
      if (!item.markerY) continue;
      if (pointInDiamond(worldX, worldY, item.x, item.markerY, markerW, markerH)) {
        return item.agent;
      }
    }

    // Check roofs
    for (let i = hitList.length - 1; i >= 0; i--) {
      const item = hitList[i];
      if (pointInDiamond(worldX, worldY, item.x, item.roofY, item.roofHitW, item.roofHitH)) {
        return item.agent;
      }
    }

    // Check base tiles
    for (let i = hitList.length - 1; i >= 0; i--) {
      const item = hitList[i];
      if (pointInDiamond(worldX, worldY, item.x, item.y, TILE_W, TILE_H)) {
        return item.agent;
      }
    }

    return null;
  }, [view]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const found = findAgentAt(x, y);
    setHovered(found);
    setTooltipPos({ x: e.clientX + 12, y: e.clientY + 12 });
  }, [findAgentAt]);

  const handleMouseLeave = useCallback(() => {
    setHovered(null);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // First try hovered state, otherwise calculate from click position
    if (hovered) {
      onSelect(hovered);
      return;
    }
    
    // Calculate from click position (for direct clicks without hover)
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const found = findAgentAt(x, y);
    if (found) {
      onSelect(found);
    }
  }, [hovered, onSelect, findAgentAt]);

  return (
    <div ref={containerRef} className="canvas-container">
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
