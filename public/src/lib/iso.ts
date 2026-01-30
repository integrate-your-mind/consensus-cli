import type { ScreenPoint, Coordinate } from '../types';

export function isoToScreen(x: number, y: number, tileW: number, tileH: number): ScreenPoint {
  return {
    x: (x - y) * (tileW / 2),
    y: (x + y) * (tileH / 2),
  };
}

export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileW: number,
  tileH: number,
  fill: string | null,
  stroke: string | null
): void {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  
  ctx.beginPath();
  ctx.moveTo(x, y - halfH);
  ctx.lineTo(x + halfW, y);
  ctx.lineTo(x, y + halfH);
  ctx.lineTo(x - halfW, y);
  ctx.closePath();
  
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export interface BuildingColors {
  top: string;
  left: string;
  right: string;
  stroke: string;
}

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileW: number,
  tileH: number,
  height: number,
  colors: BuildingColors
): void {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  const topY = y - height;

  // Top face
  ctx.beginPath();
  ctx.moveTo(x, topY - halfH);
  ctx.lineTo(x + halfW, topY);
  ctx.lineTo(x, topY + halfH);
  ctx.lineTo(x - halfW, topY);
  ctx.closePath();
  ctx.fillStyle = colors.top;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.stroke();

  // Left face
  ctx.beginPath();
  ctx.moveTo(x - halfW, topY);
  ctx.lineTo(x, topY + halfH);
  ctx.lineTo(x, y + halfH);
  ctx.lineTo(x - halfW, y);
  ctx.closePath();
  ctx.fillStyle = colors.left;
  ctx.fill();

  // Right face
  ctx.beginPath();
  ctx.moveTo(x + halfW, topY);
  ctx.lineTo(x, topY + halfH);
  ctx.lineTo(x, y + halfH);
  ctx.lineTo(x + halfW, y);
  ctx.closePath();
  ctx.fillStyle = colors.right;
  ctx.fill();
}

export function pointInDiamond(
  px: number,
  py: number,
  x: number,
  y: number,
  tileW: number,
  tileH: number
): boolean {
  const dx = Math.abs(px - x);
  const dy = Math.abs(py - y);
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  
  if (dx > halfW || dy > halfH) return false;
  return dx / halfW + dy / halfH <= 1;
}

export interface Point {
  x: number;
  y: number;
}

function sign(p1: Point, p2: Point, p3: Point): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

export function pointInQuad(pt: Point, a: Point, b: Point, c: Point, d: Point): boolean {
  let hasPos = false;
  let hasNeg = false;
  const points = [a, b, c, d];
  
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    const s = sign(pt, points[i], points[next]);
    if (s > 0) hasPos = true;
    if (s < 0) hasNeg = true;
    if (hasPos && hasNeg) return false;
  }
  
  return true;
}
