export function isoToScreen(x, y, tileW, tileH) {
  return {
    x: (x - y) * (tileW / 2),
    y: (x + y) * (tileH / 2),
  };
}

export function drawDiamond(ctx, x, y, tileW, tileH, fill, stroke) {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - halfH);
  ctx.lineTo(x + halfW, y);
  ctx.lineTo(x, y + halfH);
  ctx.lineTo(x - halfW, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function drawBuilding(ctx, x, y, tileW, tileH, height, colors) {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  const topY = y - height;

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

  ctx.beginPath();
  ctx.moveTo(x - halfW, topY);
  ctx.lineTo(x, topY + halfH);
  ctx.lineTo(x, y + halfH);
  ctx.lineTo(x - halfW, y);
  ctx.closePath();
  ctx.fillStyle = colors.left;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + halfW, topY);
  ctx.lineTo(x, topY + halfH);
  ctx.lineTo(x, y + halfH);
  ctx.lineTo(x + halfW, y);
  ctx.closePath();
  ctx.fillStyle = colors.right;
  ctx.fill();
}

export function pointInDiamond(px, py, x, y, tileW, tileH) {
  const dx = Math.abs(px - x);
  const dy = Math.abs(py - y);
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  if (dx > halfW || dy > halfH) return false;
  return dx / halfW + dy / halfH <= 1;
}
