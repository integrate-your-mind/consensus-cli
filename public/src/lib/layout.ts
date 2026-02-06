import type { AgentSnapshot, Coordinate } from '../types';
import { agentIdentity, groupKeyForAgent } from './format';
import { isoToScreen } from './iso';

const GRID_SCALE = 2;
const TILE_W = 96;
const TILE_H = 48;
const CELL_W = TILE_W;
const CELL_H = TILE_H;
const MAX_PULSE = 7;
const MAX_LAYOUT_HEIGHT = 120 + MAX_PULSE;

type CellBucket = string | string[];
export type CellKey = string;

interface BoundsRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface SpatialIndex {
  cells: Map<CellKey, CellBucket>;
  bounds: Map<string, BoundsRect>;
}

interface SpiralState {
  cx: number;
  cy: number;
  dir: 0 | 1 | 2 | 3;
  legLen: number;
  legProgress: number;
  legsAtLen: 0 | 1;
  started: boolean;
}

interface GroupState {
  anchor: Coordinate;
  spiral: SpiralState;
  freeStack: CellKey[];
}

export interface LayoutState {
  layout: Map<string, Coordinate>;
  groupAnchors: Map<string, Coordinate>;
  agentGroupKey: Map<string, string>;
  groups: Map<string, GroupState>;
  spatial: SpatialIndex;
  seenGen: Map<string, number>;
  generation: number;
  locked: boolean;
}

export function createLayoutState(): LayoutState {
  return {
    layout: new Map(),
    groupAnchors: new Map(),
    agentGroupKey: new Map(),
    groups: new Map(),
    spatial: {
      cells: new Map(),
      bounds: new Map(),
    },
    seenGen: new Map(),
    generation: 0,
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
  if (typeof agent.pid === 'number') return `${agent.pid}`;
  if (agent.id) return agent.id;
  const groupKey = groupKeyForAgent(agent);
  if (groupKey) return groupKey;
  return 'unknown';
}

function worldToCellX(x: number): number {
  return Math.floor(x / CELL_W);
}

function worldToCellY(y: number): number {
  return Math.floor(y / CELL_H);
}

export function cellKey(cx: number, cy: number): CellKey {
  // String keys avoid integer range wrapping/collisions as the layout grows.
  return `${cx},${cy}`;
}

export function unpackCell(key: CellKey): { cx: number; cy: number } {
  const comma = key.indexOf(",");
  if (comma === -1) return { cx: 0, cy: 0 };
  const cx = Number.parseInt(key.slice(0, comma), 10);
  const cy = Number.parseInt(key.slice(comma + 1), 10);
  return {
    cx: Number.isFinite(cx) ? cx : 0,
    cy: Number.isFinite(cy) ? cy : 0,
  };
}

function cellToWorld(cx: number, cy: number): Coordinate {
  return { x: cx * GRID_SCALE, y: cy * GRID_SCALE };
}

function gridKeyFromWorld(coord: Coordinate): CellKey {
  const cx = Math.round(coord.x / GRID_SCALE);
  const cy = Math.round(coord.y / GRID_SCALE);
  return cellKey(cx, cy);
}

function bucketAdd(bucket: CellBucket | undefined, id: string): CellBucket {
  if (bucket === undefined) return id;
  if (typeof bucket === 'string') {
    if (bucket === id) return bucket;
    return [bucket, id];
  }
  for (let i = 0; i < bucket.length; i += 1) {
    if (bucket[i] === id) return bucket;
  }
  bucket.push(id);
  return bucket;
}

function bucketRemove(bucket: CellBucket | undefined, id: string): CellBucket | undefined {
  if (bucket === undefined) return undefined;
  if (typeof bucket === 'string') return bucket === id ? undefined : bucket;
  const index = bucket.indexOf(id);
  if (index === -1) return bucket;
  const last = bucket.pop();
  if (last === undefined) return undefined;
  if (index < bucket.length) bucket[index] = last;
  if (bucket.length === 1) return bucket[0];
  return bucket.length ? bucket : undefined;
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

function cellRangeForBounds(bounds: BoundsRect): {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
} {
  const minCx = worldToCellX(bounds.left);
  const maxCx = worldToCellX(bounds.right - 1);
  const minCy = worldToCellY(bounds.top);
  const maxCy = worldToCellY(bounds.bottom - 1);
  return { minCx, maxCx, minCy, maxCy };
}

function indexAgent(id: string, coord: Coordinate, spatial: SpatialIndex): void {
  const bounds = boundsForCoord(coord);
  spatial.bounds.set(id, bounds);

  const range = cellRangeForBounds(bounds);
  for (let cx = range.minCx; cx <= range.maxCx; cx += 1) {
    for (let cy = range.minCy; cy <= range.maxCy; cy += 1) {
      const key = cellKey(cx, cy);
      const bucket = spatial.cells.get(key);
      spatial.cells.set(key, bucketAdd(bucket, id));
    }
  }
}

function unindexAgent(id: string, spatial: SpatialIndex): void {
  const bounds = spatial.bounds.get(id);
  if (!bounds) return;

  const range = cellRangeForBounds(bounds);
  for (let cx = range.minCx; cx <= range.maxCx; cx += 1) {
    for (let cy = range.minCy; cy <= range.maxCy; cy += 1) {
      const key = cellKey(cx, cy);
      const bucket = spatial.cells.get(key);
      const next = bucketRemove(bucket, id);
      if (next === undefined) {
        spatial.cells.delete(key);
      } else {
        spatial.cells.set(key, next);
      }
    }
  }

  spatial.bounds.delete(id);
}

function hasCollision(bounds: BoundsRect, spatial: SpatialIndex): boolean {
  const range = cellRangeForBounds(bounds);
  for (let cx = range.minCx; cx <= range.maxCx; cx += 1) {
    for (let cy = range.minCy; cy <= range.maxCy; cy += 1) {
      const key = cellKey(cx, cy);
      const bucket = spatial.cells.get(key);
      if (!bucket) continue;
      if (typeof bucket === 'string') {
        const other = spatial.bounds.get(bucket);
        if (other && boundsIntersect(bounds, other)) return true;
      } else {
        for (let i = 0; i < bucket.length; i += 1) {
          const other = spatial.bounds.get(bucket[i]);
          if (other && boundsIntersect(bounds, other)) return true;
        }
      }
    }
  }
  return false;
}

function spiralInit(anchor: Coordinate): SpiralState {
  const cx = Math.round(anchor.x / GRID_SCALE);
  const cy = Math.round(anchor.y / GRID_SCALE);
  return {
    cx,
    cy,
    dir: 0,
    legLen: 1,
    legProgress: 0,
    legsAtLen: 0,
    started: false,
  };
}

function spiralNext(state: SpiralState): { cx: number; cy: number } {
  if (!state.started) {
    state.started = true;
    return { cx: state.cx, cy: state.cy };
  }

  switch (state.dir) {
    case 0:
      state.cx += 1;
      break;
    case 1:
      state.cy -= 1;
      break;
    case 2:
      state.cx -= 1;
      break;
    case 3:
      state.cy += 1;
      break;
  }

  state.legProgress += 1;
  if (state.legProgress === state.legLen) {
    state.legProgress = 0;
    state.dir = ((state.dir + 1) & 3) as 0 | 1 | 2 | 3;
    if (state.legsAtLen === 1) {
      state.legsAtLen = 0;
      state.legLen += 1;
    } else {
      state.legsAtLen = 1;
    }
  }

  return { cx: state.cx, cy: state.cy };
}

function hashedAnchorForGroup(groupKey: string): Coordinate {
  const hash = hashString(groupKey);
  const baseX = (hash % 16) - 8;
  const baseY = ((hash >> 4) % 16) - 8;
  return { x: baseX * GRID_SCALE, y: baseY * GRID_SCALE };
}

function ensureGroupState(
  state: LayoutState,
  groupKey: string,
  fallbackAnchor?: Coordinate
): GroupState {
  let group = state.groups.get(groupKey);
  if (!group) {
    const anchor = state.groupAnchors.get(groupKey) ?? fallbackAnchor ?? hashedAnchorForGroup(groupKey);
    group = {
      anchor,
      spiral: spiralInit(anchor),
      freeStack: [],
    };
    state.groups.set(groupKey, group);
    if (!state.groupAnchors.has(groupKey)) {
      state.groupAnchors.set(groupKey, anchor);
    }
  } else if (!state.groupAnchors.has(groupKey)) {
    state.groupAnchors.set(groupKey, group.anchor);
  }
  return group;
}

function findPlacement(
  group: GroupState,
  spatial: SpatialIndex,
  maxAttempts = 256
): Coordinate | null {
  while (group.freeStack.length) {
    const key = group.freeStack.pop();
    if (key === undefined) break;
    const { cx, cy } = unpackCell(key);
    const coord = cellToWorld(cx, cy);
    const bounds = boundsForCoord(coord);
    if (!hasCollision(bounds, spatial)) return coord;
  }

  for (let i = 0; i < maxAttempts; i += 1) {
    const { cx, cy } = spiralNext(group.spiral);
    const coord = cellToWorld(cx, cy);
    const bounds = boundsForCoord(coord);
    if (!hasCollision(bounds, spatial)) return coord;
  }

  return null;
}

function addAgent(
  state: LayoutState,
  id: string,
  groupKey: string
): void {
  const hadGroup = state.groups.has(groupKey);
  const group = ensureGroupState(state, groupKey);
  const placement = findPlacement(group, state.spatial);
  if (!placement) return;
  state.layout.set(id, placement);
  state.agentGroupKey.set(id, groupKey);
  indexAgent(id, placement, state.spatial);

  if (!hadGroup) {
    group.anchor = placement;
    group.spiral = spiralInit(placement);
    state.groupAnchors.set(groupKey, placement);
  }
}

function removeAgent(state: LayoutState, id: string): void {
  const coord = state.layout.get(id);
  if (coord) {
    unindexAgent(id, state.spatial);
  }
  state.layout.delete(id);

  const groupKey = state.agentGroupKey.get(id);
  if (groupKey && coord) {
    const group = state.groups.get(groupKey);
    if (group) {
      group.freeStack.push(gridKeyFromWorld(coord));
    }
  }
  state.agentGroupKey.delete(id);
}

export function assignCoordinate(
  state: LayoutState,
  key: string,
  baseKey: string
): void {
  if (state.layout.has(key)) return;
  addAgent(state, key, baseKey || key);
}

export function updateLayout(
  state: LayoutState,
  agents: AgentSnapshot[]
): void {
  if (state.locked) return;

  if (agents.length === 0) {
    state.layout.clear();
    state.groupAnchors.clear();
    state.agentGroupKey.clear();
    state.groups.clear();
    state.spatial.cells.clear();
    state.spatial.bounds.clear();
    state.seenGen.clear();
    return;
  }

  state.generation += 1;
  const gen = state.generation;
  const added: Array<{ id: string; agent: AgentSnapshot; groupKey: string }> = [];

  for (const agent of agents) {
    const id = layoutIdForAgent(agent);
    const groupKey = groupKeyForAgent(agent) || id;
    state.seenGen.set(id, gen);
    state.agentGroupKey.set(id, groupKey);

    const existingCoord = state.layout.get(id);
    if (existingCoord) {
      ensureGroupState(state, groupKey, existingCoord);
      continue;
    }
    added.push({ id, agent, groupKey });
  }

  for (const id of Array.from(state.layout.keys())) {
    if (state.seenGen.get(id) !== gen) {
      removeAgent(state, id);
    }
  }

  added.sort((a, b) => {
    if (a.groupKey === b.groupKey) return a.id.localeCompare(b.id);
    return a.groupKey.localeCompare(b.groupKey);
  });

  for (const entry of added) {
    addAgent(state, entry.id, entry.groupKey);
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
  state.groupAnchors.clear();
  state.agentGroupKey.clear();
  state.groups.clear();
  state.spatial.cells.clear();
  state.spatial.bounds.clear();
  state.seenGen.clear();
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
    const id = layoutIdForAgent(agent);
    const groupKey = groupKeyForAgent(agent) || id;
    const coord = { x: Number(entry.x) || 0, y: Number(entry.y) || 0 };
    state.layout.set(id, coord);
    state.agentGroupKey.set(id, groupKey);
    indexAgent(id, coord, state.spatial);
    const group = ensureGroupState(state, groupKey, coord);
    if (!state.groupAnchors.has(groupKey)) {
      state.groupAnchors.set(groupKey, coord);
    }
    if (!group.spiral.started) {
      group.anchor = coord;
      group.spiral = spiralInit(coord);
    }
  }
}
