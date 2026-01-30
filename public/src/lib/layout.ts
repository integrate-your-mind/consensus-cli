import type { AgentSnapshot, Coordinate } from '../types';
import { agentIdentity, groupKeyForAgent } from './format';
import { isoToScreen } from './iso';

const GRID_SCALE = 2;
const TILE_W = 96;
const TILE_H = 48;
const MAX_PULSE = 7;
const MAX_LAYOUT_HEIGHT = 120 + MAX_PULSE;

interface BoundsRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface LayoutState {
  layout: Map<string, Coordinate>;
  occupied: Map<string, string>;
  bounds: Map<string, BoundsRect>;
  groupAnchors: Map<string, Coordinate>;
  locked: boolean;
}

export function createLayoutState(): LayoutState {
  return {
    layout: new Map(),
    occupied: new Map(),
    bounds: new Map(),
    groupAnchors: new Map(),
    locked: false,
  };
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function layoutIdForAgent(agent: AgentSnapshot): string {
  const identity = agentIdentity(agent);
  if (identity) return identity;
  const groupKey = groupKeyForAgent(agent);
  if (groupKey) return groupKey;
  if (typeof agent.pid === 'number') return `${agent.pid}`;
  return agent.id || 'unknown';
}

function boundsForCoord(coord: Coordinate): BoundsRect {
  const screen = isoToScreen(coord.x, coord.y, TILE_W, TILE_H);
  const halfW = TILE_W / 2;
  const halfH = TILE_H / 2;
  return {
    left: screen.x - halfW,
    right: screen.x + halfW,
    top: screen.y - MAX_LAYOUT_HEIGHT - halfH,
    bottom: screen.y + halfH,
  };
}

function boundsIntersect(a: BoundsRect, b: BoundsRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function hasBoundsOverlap(testBounds: BoundsRect, placedBounds: Map<string, BoundsRect>): boolean {
  for (const bounds of placedBounds.values()) {
    if (boundsIntersect(testBounds, bounds)) return true;
  }
  return false;
}

function tryPlaceCoordinate(
  coord: Coordinate,
  nextOccupied: Map<string, string>,
  nextBounds: Map<string, BoundsRect>
): { coord: Coordinate; bounds: BoundsRect; cellKey: string } | null {
  const cellKey = `${coord.x / GRID_SCALE},${coord.y / GRID_SCALE}`;
  if (nextOccupied.has(cellKey)) return null;
  const testBounds = boundsForCoord(coord);
  if (hasBoundsOverlap(testBounds, nextBounds)) return null;
  return { coord, bounds: testBounds, cellKey };
}

function findPlacementNearAnchor(
  anchor: Coordinate,
  maxRadius: number,
  nextOccupied: Map<string, string>,
  nextBounds: Map<string, BoundsRect>
): { coord: Coordinate; bounds: BoundsRect; cellKey: string } | null {
  const baseX = Math.round(anchor.x / GRID_SCALE);
  const baseY = Math.round(anchor.y / GRID_SCALE);

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const coord = { x: (baseX + dx) * GRID_SCALE, y: (baseY + dy) * GRID_SCALE };
        const placed = tryPlaceCoordinate(coord, nextOccupied, nextBounds);
        if (placed) return placed;
      }
    }
  }

  return null;
}

function hashedAnchorForGroup(groupKey: string): Coordinate {
  const hash = hashString(groupKey);
  const baseX = (hash % 16) - 8;
  const baseY = ((hash >> 4) % 16) - 8;
  return { x: baseX * GRID_SCALE, y: baseY * GRID_SCALE };
}

export function assignCoordinate(
  state: LayoutState,
  key: string,
  baseKey: string
): void {
  if (state.layout.has(key)) return;
  const anchor = state.groupAnchors.get(baseKey) ?? hashedAnchorForGroup(baseKey || key);
  const maxRadius = Math.max(24, Math.ceil(Math.sqrt(state.layout.size + 1)) * 32);
  const placement = findPlacementNearAnchor(anchor, maxRadius, state.occupied, state.bounds);
  if (!placement) return;
  state.layout.set(key, placement.coord);
  state.occupied.set(placement.cellKey, key);
  state.bounds.set(key, placement.bounds);
  if (!state.groupAnchors.has(baseKey)) {
    state.groupAnchors.set(baseKey, placement.coord);
  }
}

export function updateLayout(
  state: LayoutState,
  agents: AgentSnapshot[]
): void {
  if (state.locked) return;
  if (agents.length === 0) {
    state.layout.clear();
    state.occupied.clear();
    state.bounds.clear();
    state.groupAnchors.clear();
    return;
  }

  const agentMap = new Map<string, { agent: AgentSnapshot; groupKey: string }>();
  for (const agent of agents) {
    const id = layoutIdForAgent(agent);
    const groupKey = groupKeyForAgent(agent) || id;
    agentMap.set(id, { agent, groupKey });
  }

  for (const id of state.layout.keys()) {
    if (!agentMap.has(id)) {
      const coord = state.layout.get(id);
      if (coord) {
        state.occupied.delete(`${coord.x / GRID_SCALE},${coord.y / GRID_SCALE}`);
      }
      state.layout.delete(id);
      state.bounds.delete(id);
    }
  }

  state.occupied.clear();
  state.bounds.clear();
  for (const [id, coord] of state.layout.entries()) {
    state.occupied.set(`${coord.x / GRID_SCALE},${coord.y / GRID_SCALE}`, id);
    state.bounds.set(id, boundsForCoord(coord));
  }

  const activeGroups = new Set<string>();
  for (const { agent, groupKey } of agentMap.values()) {
    activeGroups.add(groupKey);
    if (!state.groupAnchors.has(groupKey)) {
      const coord = state.layout.get(layoutIdForAgent(agent));
      if (coord) state.groupAnchors.set(groupKey, coord);
    }
  }
  for (const key of state.groupAnchors.keys()) {
    if (!activeGroups.has(key)) state.groupAnchors.delete(key);
  }

  const addedAgents = Array.from(agentMap.values())
    .filter(({ agent }) => !state.layout.has(layoutIdForAgent(agent)))
    .sort((a, b) => {
      if (a.groupKey === b.groupKey) {
        return layoutIdForAgent(a.agent).localeCompare(layoutIdForAgent(b.agent));
      }
      return a.groupKey.localeCompare(b.groupKey);
    });

  const maxRadius = Math.max(32, Math.ceil(Math.sqrt(state.layout.size + addedAgents.length)) * 32);

  for (const entry of addedAgents) {
    const layoutId = layoutIdForAgent(entry.agent);
    const groupKey = entry.groupKey || layoutId;
    const anchor = state.groupAnchors.get(groupKey) ?? hashedAnchorForGroup(groupKey);
    const placement = findPlacementNearAnchor(anchor, maxRadius, state.occupied, state.bounds);
    if (!placement) continue;
    state.layout.set(layoutId, placement.coord);
    state.occupied.set(placement.cellKey, layoutId);
    state.bounds.set(layoutId, placement.bounds);
    if (!state.groupAnchors.has(groupKey)) {
      state.groupAnchors.set(groupKey, placement.coord);
    }
  }
}

export function getCoordinate(
  state: LayoutState,
  agent: AgentSnapshot
): Coordinate | undefined {
  return state.layout.get(layoutIdForAgent(agent));
}

export function lockLayout(state: LayoutState): void {
  state.locked = true;
}

export function unlockLayout(state: LayoutState): void {
  state.locked = false;
}

export function setLayoutPositions(
  state: LayoutState,
  agents: AgentSnapshot[],
  positions: Array<{ id?: string; pid?: number; x: number; y: number }>
): void {
  state.layout.clear();
  state.occupied.clear();
  state.bounds.clear();
  state.groupAnchors.clear();
  state.locked = true;
  
  const byIdentity = new Map(
    agents.map((agent) => [agentIdentity(agent), agent])
  );
  const byPid = new Map(
    agents
      .filter((agent) => typeof agent.pid === 'number')
      .map((agent) => [`${agent.pid}`, agent])
  );
  
  for (const entry of positions) {
    const keyId = entry?.id ?? entry?.pid;
    if (keyId === undefined || keyId === null) continue;
    const agent =
      byIdentity.get(String(keyId)) || byPid.get(String(keyId)) || null;
    if (!agent) continue;
    const key = layoutIdForAgent(agent);
    const coord = { x: Number(entry.x) || 0, y: Number(entry.y) || 0 };
    state.layout.set(key, coord);
    state.occupied.set(`${coord.x / GRID_SCALE},${coord.y / GRID_SCALE}`, key);
    state.bounds.set(key, boundsForCoord(coord));
    const groupKey = groupKeyForAgent(agent) || key;
    if (!state.groupAnchors.has(groupKey)) {
      state.groupAnchors.set(groupKey, coord);
    }
  }
}
