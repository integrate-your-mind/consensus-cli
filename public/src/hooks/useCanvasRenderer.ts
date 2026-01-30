import { useRef, useEffect, useCallback } from 'react';
import type { AgentSnapshot, ViewState } from '../types';
import { isoToScreen, drawDiamond, drawBuilding, pointInDiamond, pointInQuad } from '../lib/iso';
import { paletteFor, accentFor, accentStrongFor, accentSoftFor, accentGlow, opacityFor, isServerKind } from '../lib/palette';
import { labelFor, truncate, agentIdentity, keyForAgent } from '../lib/format';
import { getCoordinate, type LayoutState } from '../lib/layout';

const TILE_W = 96;
const TILE_H = 48;
const ROOF_SCALE = 0.28;
const ROOF_HIT_SCALE = 0.44;
const MARKER_SCALE = 0.36;
const MARKER_OFFSET = TILE_H * 0.6;

interface RendererOptions {
  layout: LayoutState;
  hovered: AgentSnapshot | null;
  selected: AgentSnapshot | null;
  spawnTimes: Map<string, number>;
  deviceScale: number;
}

interface RenderContext {
  ctx: CanvasRenderingContext2D;
  view: ViewState;
  agents: AgentSnapshot[];
  options: RendererOptions;
  width: number;
  height: number;
}

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

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  accent: string
): void {
  if (!text) return;
  
  ctx.save();
  ctx.font = '11px IBM Plex Mono';
  ctx.textAlign = 'center';
  const paddingX = 8;
  const paddingY = 4;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 18;
  const left = x - width / 2;
  const top = y - height;
  
  ctx.fillStyle = 'rgba(10, 14, 18, 0.85)';
  drawRoundedRect(ctx, left, top, width, height, 6);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#e4e6eb';
  ctx.fillText(text, x, top + height - paddingY - 2);
  ctx.restore();
}

function renderFrame(context: RenderContext): HitItem[] {
  const { ctx, view, agents, options, width, height } = context;
  const { layout, hovered, selected, spawnTimes, deviceScale } = options;
  
  const roofW = TILE_W * ROOF_SCALE;
  const roofH = roofW * 0.5;
  const roofHitW = TILE_W * ROOF_HIT_SCALE;
  const roofHitH = roofHitW * 0.5;
  const markerW = TILE_W * MARKER_SCALE;
  const markerH = markerW * 0.5;

  // Clear and setup transform
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  ctx.clearRect(0, 0, width / deviceScale, height / deviceScale);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  if (agents.length === 0) {
    ctx.fillStyle = 'rgba(228, 230, 235, 0.6)';
    ctx.font = '16px Space Grotesk';
    ctx.textAlign = 'center';
    ctx.fillText('No codex processes found', 0, 0);
    ctx.restore();
    return [];
  }

  const time = Date.now();
  const spawnDuration = 260;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hitList: HitItem[] = [];
  const roofList: Array<{
    x: number;
    y: number;
    agent: AgentSnapshot;
    paletteStroke: string;
    accent: string;
    accentStrong: string;
    identity: string;
    pulsePhase: number;
    isActive: boolean;
    isSelected: boolean;
    spawnAlpha: number;
  }> = [];
  const obstructedIds = new Set<string>();

  // Sort by depth
  const sortedAgents = agents
    .map((agent) => {
      const key = keyForAgent(agent);
      const coord = getCoordinate(layout, agent) ?? { x: 0, y: 0 };
      const screen = isoToScreen(coord.x, coord.y, TILE_W, TILE_H);
      return { agent, key, coord, screen };
    })
    .sort((a, b) => a.coord.x + a.coord.y - (b.coord.x + b.coord.y));

  // Get top active agents
  const activeAgents = sortedAgents
    .filter((item) => item.agent.state !== 'idle')
    .sort((a, b) => b.agent.cpu - a.agent.cpu);
  const topActiveIds = new Set(activeAgents.slice(0, 4).map((item) => agentIdentity(item.agent)));

  // Draw buildings
  for (const item of sortedAgents) {
    const palette = paletteFor(item.agent);
    const memMB = item.agent.mem / (1024 * 1024);
    const heightBase = Math.min(120, Math.max(18, memMB * 0.4));
    const isActive = item.agent.state === 'active';
    const idleScale = item.agent.state === 'idle' ? 0.6 : 1;
    const pulse = isActive && !reducedMotion ? 4 + Math.sin(time / 200) * 3 : 0;
    let height = heightBase * idleScale + pulse;
    let spawnScale = 1;
    let spawnAlpha = 1;
    const spawnStart = spawnTimes.get(agentIdentity(item.agent));
    if (spawnStart) {
      const elapsed = time - spawnStart;
      if (elapsed >= 0 && elapsed < spawnDuration) {
        const t = Math.min(1, elapsed / spawnDuration);
        const ease = 1 - Math.pow(1 - t, 3);
        spawnScale = 0.7 + 0.3 * ease;
        spawnAlpha = 0.4 + 0.6 * ease;
        height *= spawnScale;
      }
    }
    const pulsePhase = isActive && !reducedMotion ? (Math.sin(time / 240) + 1) / 2 : 0;

    const accent = accentFor(item.agent);
    const accentStrong = accentStrongFor(item.agent);
    const accentSoft = accentSoftFor(item.agent);

    const x = item.screen.x;
    const y = item.screen.y;
    const roofY = y - height - TILE_H * 0.15;

    // Draw building
    ctx.globalAlpha = opacityFor(item.agent.state) * spawnAlpha;
    drawBuilding(ctx, x, y, TILE_W, TILE_H, height, palette);
    drawDiamond(ctx, x, y, TILE_W, TILE_H, 'rgba(16, 22, 28, 0.8)', '#3e4e59');
    ctx.globalAlpha = 1;

    // Active glow
    if (isActive) {
      const glowAlpha = (0.12 + pulsePhase * 0.22) * spawnAlpha;
      ctx.save();
      drawDiamond(
        ctx,
        x,
        y + TILE_H * 0.02,
        TILE_W * 0.92,
        TILE_H * 0.46,
        accentGlow(item.agent, glowAlpha),
        null
      );
      ctx.restore();
    }

    // Selection outline
    if (selected && agentIdentity(selected) === agentIdentity(item.agent)) {
      drawDiamond(ctx, x, y, TILE_W + 10, TILE_H + 6, 'rgba(0,0,0,0)', accent);
    }

    // Shadow
    ctx.fillStyle = 'rgba(10, 12, 15, 0.6)';
    ctx.beginPath();
    ctx.ellipse(x, y + TILE_H * 0.7, TILE_W * 0.4, TILE_H * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tags
    const isHovered = hovered && agentIdentity(hovered) === agentIdentity(item.agent);
    const isSelected = !!selected && agentIdentity(selected) === agentIdentity(item.agent);
    const showActiveTag = topActiveIds.has(agentIdentity(item.agent));
    const isServer = isServerKind(item.agent.kind);

    if (isHovered || isSelected) {
      const label = truncate(labelFor(item.agent), 20);
      drawTag(ctx, x, y - height - TILE_H * 0.6, label, accentStrong);
      const doing = truncate(item.agent.summary?.current || item.agent.doing || '', 36);
      drawTag(ctx, x, y - height - TILE_H * 0.9, doing, accentSoft);
      if (isServer) {
        drawTag(ctx, x, y + TILE_H * 0.2, 'server', 'rgba(79, 107, 122, 0.6)');
      }
    } else if (showActiveTag) {
      const doing = truncate(item.agent.summary?.current || item.agent.doing || labelFor(item.agent), 32);
      drawTag(ctx, x, y - height - TILE_H * 0.7, doing, accentSoft);
      if (isServer) {
        drawTag(ctx, x, y + TILE_H * 0.2, 'server', 'rgba(79, 107, 122, 0.6)');
      }
    }

    hitList.push({
      x,
      y,
      roofY,
      roofW,
      roofH,
      roofHitW,
      roofHitH,
      height,
      agent: item.agent,
      key: item.key,
    });

    roofList.push({
      x,
      y: roofY,
      agent: item.agent,
      paletteStroke: palette.stroke,
      accent,
      accentStrong,
      identity: agentIdentity(item.agent),
      pulsePhase,
      isActive,
      isSelected,
      spawnAlpha,
    });
  }

  // Collision detection
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

  // Mark obstructed
  for (const item of hitList) {
    if (obstructedIds.has(agentIdentity(item.agent))) {
      item.markerY = item.roofY - MARKER_OFFSET;
    }
  }

  // Draw roofs
  for (const item of roofList) {
    ctx.save();
    ctx.globalAlpha = item.spawnAlpha;
    drawDiamond(ctx, item.x, item.y, roofW, roofH, item.paletteStroke, null);
    
    if (item.isActive) {
      const capAlpha = 0.16 + item.pulsePhase * 0.28;
      drawDiamond(
        ctx,
        item.x,
        item.y,
        roofW * 0.82,
        roofH * 0.82,
        accentGlow(item.agent, capAlpha),
        null
      );
    }
    ctx.restore();

    if (item.isSelected) {
      const selectedRoofW = roofW + 8;
      const selectedRoofH = selectedRoofW * 0.5;
      ctx.save();
      ctx.globalAlpha = item.spawnAlpha;
      drawDiamond(ctx, item.x, item.y, selectedRoofW, selectedRoofH, 'rgba(0,0,0,0)', item.accent);
      ctx.restore();
    }

    if (obstructedIds.has(item.identity)) {
      ctx.save();
      ctx.globalAlpha = item.spawnAlpha;
      drawDiamond(
        ctx,
        item.x,
        item.y - MARKER_OFFSET,
        markerW,
        markerH,
        'rgba(0,0,0,0)',
        item.accentStrong
      );
      ctx.restore();
    }
  }

  ctx.restore();
  return hitList;
}

export function useCanvasRenderer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitListRef = useRef<HitItem[]>([]);
  const rafRef = useRef<number | null>(null);
  const deviceScaleRef = useRef(1);

  const startRender = useCallback((
    view: ViewState,
    agents: AgentSnapshot[],
    options: RendererOptions
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Update canvas size
    deviceScaleRef.current = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * deviceScaleRef.current;
    canvas.height = window.innerHeight * deviceScaleRef.current;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      
      hitListRef.current = renderFrame({
        ctx,
        view,
        agents,
        options: { ...options, deviceScale: deviceScaleRef.current },
        width,
        height,
      });
      
      rafRef.current = requestAnimationFrame(render);
    };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(render);
  }, []);

  const stopRender = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const getAgentAtPoint = useCallback((screenX: number, screenY: number): AgentSnapshot | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;

    const viewX = (x - canvas.width / 2 / deviceScaleRef.current) / 1; // simplified
    const viewY = (y - canvas.height / 2 / deviceScaleRef.current) / 1;

    // Transform to world space (this needs proper view transform)
    // For now, return simplified hit detection
    const hitList = hitListRef.current;
    if (!hitList.length) return null;

    // Check markers first
    for (let i = hitList.length - 1; i >= 0; i -= 1) {
      const item = hitList[i];
      if (!item.markerY) continue;
      const markerW = TILE_W * MARKER_SCALE;
      const markerH = markerW * 0.5;
      if (pointInDiamond(viewX, viewY, item.x, item.markerY, markerW, markerH)) {
        return item.agent;
      }
    }

    // Check roofs
    for (let i = hitList.length - 1; i >= 0; i -= 1) {
      const item = hitList[i];
      const roofHitW = item.roofHitW;
      const roofHitH = item.roofHitH;
      if (pointInDiamond(viewX, viewY, item.x, item.roofY, roofHitW, roofHitH)) {
        return item.agent;
      }
    }

    // Check base
    for (let i = hitList.length - 1; i >= 0; i -= 1) {
      const item = hitList[i];
      if (pointInDiamond(viewX, viewY, item.x, item.y, TILE_W, TILE_H)) {
        return item.agent;
      }
    }

    return null;
  }, []);

  useEffect(() => {
    return () => {
      stopRender();
    };
  }, [stopRender]);

  return {
    canvasRef,
    startRender,
    stopRender,
    getAgentAtPoint,
  };
}
