import { isoToScreen, drawDiamond, drawBuilding, pointInDiamond } from "./iso.js";

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const panel = document.getElementById("panel");
const panelContent = document.getElementById("panel-content");
const panelClose = document.getElementById("panel-close");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const activeList = document.getElementById("active-list");
const serverList = document.getElementById("server-list");
const searchInput = document.getElementById("search");
const laneTitle = document.querySelector(".lane-title");
const serverTitle = document.querySelector(".server-title");

const tileW = 96;
const tileH = 48;
const gridScale = 2;
const roofScale = 0.28;
const roofHitScale = 0.44;
const roofW = tileW * roofScale;
const roofH = roofW * 0.5;
const roofHitW = tileW * roofHitScale;
const roofHitH = roofHitW * 0.5;
const markerScale = 0.36;
const markerW = tileW * markerScale;
const markerH = markerW * 0.5;
const markerOffset = tileH * 0.6;

const query = new URLSearchParams(window.location.search);
const mockMode = query.get("mock") === "1";
const wsOverrideRaw =
  query.get("ws") ||
  (() => {
    const match = window.location.href.match(/[?&]ws=([^&]+)/);
    return match ? match[1] : null;
  })();
const wsOverrideDecoded = wsOverrideRaw ? decodeURIComponent(wsOverrideRaw) : null;
let wsOverride = null;
if (wsOverrideDecoded) {
  if (wsOverrideDecoded.startsWith("ws://") || wsOverrideDecoded.startsWith("wss://")) {
    wsOverride = wsOverrideDecoded;
  } else if (
    wsOverrideDecoded.startsWith("http://") ||
    wsOverrideDecoded.startsWith("https://")
  ) {
    wsOverride = wsOverrideDecoded.replace(/^http/, "ws");
  }
}
if (wsOverrideRaw || mockMode) {
  window.__consensusDebug = {
    wsOverride,
    wsOverrideRaw,
    search: window.location.search,
  };
}

const cliPalette = {
  codex: {
    agent: {
      active: { top: "#3d8f7f", left: "#2d6d61", right: "#275b52", stroke: "#54cdb1" },
      idle: { top: "#384a57", left: "#2b3943", right: "#25323b", stroke: "#4f6b7a" },
      error: { top: "#82443c", left: "#6d3530", right: "#5a2c28", stroke: "#d1584b" },
    },
    server: {
      active: { top: "#4e665e", left: "#3d524b", right: "#32453f", stroke: "#79b8a8" },
      idle: { top: "#353f48", left: "#2a323a", right: "#232a30", stroke: "#526577" },
      error: { top: "#82443c", left: "#6d3530", right: "#5a2c28", stroke: "#d1584b" },
    },
    accent: "#57f2c6",
    accentStrong: "rgba(87, 242, 198, 0.6)",
    accentSoft: "rgba(87, 242, 198, 0.35)",
    glow: "87, 242, 198",
  },
  opencode: {
    agent: {
      active: { top: "#8a6a2f", left: "#6f5626", right: "#5b4621", stroke: "#f1bd4f" },
      idle: { top: "#3c3a37", left: "#2f2d2a", right: "#262322", stroke: "#7f6f56" },
      error: { top: "#86443b", left: "#70352f", right: "#5c2c28", stroke: "#e0705c" },
    },
    server: {
      active: { top: "#7d6a2b", left: "#665725", right: "#54481f", stroke: "#f5c453" },
      idle: { top: "#353b42", left: "#272c33", right: "#1f242a", stroke: "#6b7380" },
      error: { top: "#86443b", left: "#70352f", right: "#5c2c28", stroke: "#e0705c" },
    },
    accent: "#f5c453",
    accentStrong: "rgba(245, 196, 83, 0.6)",
    accentSoft: "rgba(245, 196, 83, 0.35)",
    glow: "245, 196, 83",
  },
  claude: {
    agent: {
      active: { top: "#3f6fa3", left: "#2f5580", right: "#25476a", stroke: "#7fb7ff" },
      idle: { top: "#374252", left: "#2a323f", right: "#232a35", stroke: "#5c6f85" },
      error: { top: "#7f4140", left: "#683334", right: "#552a2b", stroke: "#e06b6a" },
    },
    server: {
      active: { top: "#4b5f74", left: "#3a4a5c", right: "#2f3d4d", stroke: "#91b4d6" },
      idle: { top: "#323b47", left: "#262d36", right: "#20262d", stroke: "#556577" },
      error: { top: "#7f4140", left: "#683334", right: "#552a2b", stroke: "#e06b6a" },
    },
    accent: "#7fb7ff",
    accentStrong: "rgba(127, 183, 255, 0.6)",
    accentSoft: "rgba(127, 183, 255, 0.35)",
    glow: "127, 183, 255",
  },
};
const stateOpacity = {
  active: 1,
  idle: 0.35,
  error: 0.9,
};

const view = {
  x: 0,
  y: 0,
  scale: 1,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

let deviceScale = 1;
let agents = [];
let hovered = null;
let selected = null;
let searchQuery = "";
let searchMatches = new Set();
let wsLastMessageAt = Date.now();
let wsHealthTimer = null;
let wsSeq = 0;
let pendingSnapshot = null;
let pendingSnapshotSeq = 0;
let lastAppliedSeq = 0;
const WS_STALE_MS = 5000;
let wsStatus = "connecting…";
let latestMeta = {};
let ledgerSeq = 0;
let ledgerTs = 0;
let ledgerMeta = {};
const ledgerAgents = new Map();

const layout = new Map();
const occupied = new Map();
let layoutLocked = false;

function ensureSelectedVisible(agent) {
  if (!agent || !panel.classList.contains("open")) return;
  if (view.dragging) return;
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.width >= window.innerWidth * 0.8) return;
  const key = keyForAgent(agent);
  const coord = layout.get(key);
  if (!coord) return;

  const screen = isoToScreen(coord.x, coord.y, tileW, tileH);
  const memMB = (agent.mem || 0) / (1024 * 1024);
  const heightBase = Math.min(120, Math.max(18, memMB * 0.4));
  const idleScale = agent.state === "idle" ? 0.6 : 1;
  const height = heightBase * idleScale;

  const targetX = view.x + screen.x * view.scale;
  const targetY = view.y + screen.y * view.scale;
  const halfW = (tileW / 2) * view.scale;
  const halfH = (tileH / 2) * view.scale;
  const padding = 36;
  const viewportWidth = window.innerWidth - panelRect.width;
  const viewportHeight = window.innerHeight;

  const left = targetX - halfW;
  const right = targetX + halfW;
  const top = targetY - (height + tileH * 0.6) * view.scale;
  const bottom = targetY + (halfH + tileH * 0.6) * view.scale;

  let dx = 0;
  let dy = 0;
  if (right > viewportWidth - padding) {
    dx = viewportWidth - padding - right;
  } else if (left < padding) {
    dx = padding - left;
  }
  if (top < padding) {
    dy = padding - top;
  } else if (bottom > viewportHeight - padding) {
    dy = viewportHeight - padding - bottom;
  }

  if (dx !== 0 || dy !== 0) {
    view.x += dx;
    view.y += dy;
  }
}

function resize() {
  deviceScale = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * deviceScale;
  canvas.height = window.innerHeight * deviceScale;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  view.x = window.innerWidth / 2;
  view.y = window.innerHeight / 2;
}

window.addEventListener("resize", resize);
resize();

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function agentIdentity(agent) {
  const identity = agent.identity || agent.sessionPath;
  if (identity) return identity;
  const kind = typeof agent.kind === "string" ? agent.kind : "";
  const isServer = kind === "app-server" || kind === "opencode-server";
  if (!isServer) {
    return agent.id || `${agent.pid}`;
  }
  return agent.id || `${agent.pid}`;
}

function groupKeyForAgent(agent) {
  return agent.repo || agent.cwd || agent.cmd || agentIdentity(agent);
}

function keyForAgent(agent) {
  return `${groupKeyForAgent(agent)}::${agentIdentity(agent)}`;
}

function assignCoordinate(key, baseKey) {
  const hash = hashString(baseKey || key);
  const baseX = (hash % 16) - 8;
  const baseY = ((hash >> 4) % 16) - 8;
  const maxRadius = 20;

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = baseX + dx;
        const y = baseY + dy;
        const keyStr = `${x},${y}`;
        if (!occupied.has(keyStr)) {
          occupied.set(keyStr, key);
          layout.set(key, { x: x * gridScale, y: y * gridScale });
          return;
        }
      }
    }
  }

  layout.set(key, { x: baseX * gridScale, y: baseY * gridScale });
}

function updateLayout(newAgents) {
  if (layoutLocked) return;
  const activeKeys = new Set();
  for (const agent of newAgents) {
    const key = keyForAgent(agent);
    const baseKey = groupKeyForAgent(agent);
    activeKeys.add(key);
    if (!layout.has(key)) {
      assignCoordinate(key, baseKey);
    }
  }

  for (const [key, coord] of layout.entries()) {
    if (!activeKeys.has(key)) {
      layout.delete(key);
      occupied.delete(`${coord.x / gridScale},${coord.y / gridScale}`);
    }
  }
}

function renderStatus() {
  const suffixes = [];
  const opencode = latestMeta && latestMeta.opencode ? latestMeta.opencode : null;
  if (opencode && opencode.ok === false) {
    if (opencode.reachable === false) {
      suffixes.push("OpenCode API unreachable");
    } else if (opencode.error === "non_json") {
      suffixes.push("OpenCode API bad response");
    } else if (typeof opencode.status === "number") {
      suffixes.push(`OpenCode API ${opencode.status}`);
    } else if (opencode.error) {
      suffixes.push(`OpenCode API ${opencode.error}`);
    } else {
      suffixes.push("OpenCode API error");
    }
  }

  if ((wsStatus === "live" || wsStatus === "stale") && suffixes.length) {
    statusEl.textContent = `${wsStatus} • ${suffixes.join(" • ")}`;
    return;
  }
  statusEl.textContent = wsStatus;
}

function setStatus(text) {
  wsStatus = text;
  renderStatus();
}

function setCount(agentCount, serverCount) {
  const agentLabel = `${agentCount} agent${agentCount === 1 ? "" : "s"}`;
  if (typeof serverCount === "number") {
    const serverLabel = `${serverCount} server${serverCount === 1 ? "" : "s"}`;
    countEl.textContent = `${agentLabel} • ${serverLabel}`;
    return;
  }
  countEl.textContent = agentLabel;
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function truncate(text, max) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isServerKind(kind) {
  return kind === "app-server" || kind === "opencode-server";
}

const STATE_RANK = { error: 3, active: 2, idle: 1 };

function pickBetterAgent(a, b) {
  const rankA = STATE_RANK[a.state] ?? 0;
  const rankB = STATE_RANK[b.state] ?? 0;
  if (rankA !== rankB) return rankA > rankB ? a : b;

  const eventA = a.lastEventAt ?? 0;
  const eventB = b.lastEventAt ?? 0;
  if (eventA !== eventB) return eventA > eventB ? a : b;

  if (a.cpu !== b.cpu) return a.cpu > b.cpu ? a : b;
  if (a.mem !== b.mem) return a.mem > b.mem ? a : b;

  const startA = a.startedAt ?? 0;
  const startB = b.startedAt ?? 0;
  if (startA !== startB) return startA > startB ? a : b;

  return a;
}

function dedupeAgentsByIdentity(list) {
  const byKey = new Map();
  for (const agent of list) {
    const identity = agentIdentity(agent) || `${agent.pid}`;
    const scope = isServerKind(agent.kind) ? "server" : "agent";
    const key = `${scope}:${identity}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, agent);
      continue;
    }
    byKey.set(key, pickBetterAgent(existing, agent));
  }
  return [...byKey.values()];
}

function normalizeState(value) {
  if (typeof value !== "string") return "idle";
  const state = value.trim().toLowerCase();
  if (state === "active" || state === "idle" || state === "error") return state;
  return "idle";
}

function cliForAgent(agent) {
  const kind = agent.kind || "";
  if (kind.startsWith("opencode")) return "opencode";
  if (kind.startsWith("claude")) return "claude";
  return "codex";
}

function paletteFor(agent) {
  const cli = cliForAgent(agent);
  const palette = cliPalette[cli] || cliPalette.codex;
  const scope = isServerKind(agent.kind) ? palette.server : palette.agent;
  return scope[agent.state] || scope.idle;
}

function accentFor(agent) {
  const cli = cliForAgent(agent);
  return (cliPalette[cli] || cliPalette.codex).accent;
}

function accentStrongFor(agent) {
  const cli = cliForAgent(agent);
  return (cliPalette[cli] || cliPalette.codex).accentStrong;
}

function accentSoftFor(agent) {
  const cli = cliForAgent(agent);
  return (cliPalette[cli] || cliPalette.codex).accentSoft;
}

function accentGlow(agent, alpha) {
  const cli = cliForAgent(agent);
  const tint = (cliPalette[cli] || cliPalette.codex).glow;
  return `rgba(${tint}, ${alpha})`;
}

function labelFor(agent) {
  if (agent.title) return agent.title;
  if (agent.repo) return agent.repo;
  return `codex#${agent.pid}`;
}

function matchesQuery(agent, query) {
  const haystack = [
    agent.pid,
    agent.title,
    agent.summary?.current,
    agent.summary?.lastCommand,
    agent.summary?.lastEdit,
    agent.summary?.lastMessage,
    agent.summary?.lastTool,
    agent.summary?.lastPrompt,
    agent.lastEventAt,
    agent.cmd,
    agent.cwd,
    agent.sessionPath,
    agent.model,
    agent.repo,
    agent.kind,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ");
  return haystack.includes(query);
}

function roundRect(ctx, x, y, width, height, radius) {
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

function pointInQuad(pt, a, b, c, d) {
  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  let hasPos = false;
  let hasNeg = false;
  const points = [a, b, c, d];
  for (let i = 0; i < points.length; i += 1) {
    const next = (i + 1) % points.length;
    const s = sign(pt, points[i], points[next]);
    if (s > 0) hasPos = true;
    if (s < 0) hasNeg = true;
    if (hasPos && hasNeg) return false;
  }
  return true;
}

function drawTag(ctx, x, y, text, accent) {
  if (!text) return;
  ctx.save();
  ctx.font = "11px IBM Plex Mono";
  ctx.textAlign = "center";
  const paddingX = 8;
  const paddingY = 4;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 18;
  const left = x - width / 2;
  const top = y - height;
  ctx.fillStyle = "rgba(10, 14, 18, 0.85)";
  roundRect(ctx, left, top, width, height, 6);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#e4e6eb";
  ctx.fillText(text, x, top + height - paddingY - 2);
  ctx.restore();
}

function renderLaneList(items, container, emptyLabel) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="lane-meta">${emptyLabel}</div>`;
    return;
  }
  const sorted = [...items].sort((a, b) => {
    const rank = { error: 0, active: 1, idle: 2 };
    const rankA = rank[a.state] ?? 3;
    const rankB = rank[b.state] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    return b.cpu - a.cpu;
  });

  container.innerHTML = sorted
    .map((agent) => {
      const doingRaw = agent.summary?.current || agent.doing || agent.cmdShort || "";
      const doing = escapeHtml(truncate(doingRaw, 80));
      const selectedClass =
        selected && agentIdentity(selected) === agentIdentity(agent) ? "is-selected" : "";
      const accent = accentFor(agent);
      const accentGlow = accentSoftFor(agent);
      const cli = cliForAgent(agent);
      const label = escapeHtml(labelFor(agent));
      const isActive = agent.state === "active";
      const laneId = agentIdentity(agent);
      const laneTestId = escapeHtml(`lane-${laneId}`);
      const laneState = escapeHtml(agent.state || "idle");
      return `
        <button class="lane-item ${selectedClass} cli-${cli}" type="button" data-id="${laneId}" data-testid="${laneTestId}" data-state="${laneState}" data-active="${isActive}" aria-busy="${isActive}" style="--cli-accent: ${accent}; --cli-accent-glow: ${accentGlow};">
          <div class="lane-pill ${agent.state}"></div>
          <div class="lane-copy">
            <div class="lane-label">${label}</div>
            <div class="lane-meta">${doing}</div>
          </div>
        </button>
      `;
    })
    .join("");

  Array.from(container.querySelectorAll(".lane-item")).forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.getAttribute("data-id");
      selected = sorted.find((agent) => agentIdentity(agent) === id) || null;
      renderPanel(selected);
    });
  });
}

function renderPanel(agent) {
  if (!agent) {
    panel.classList.remove("open");
    panelContent.innerHTML = "";
    return;
  }
  panel.classList.add("open");
  const events = agent.events || [];
  const orderedEvents = [...events].reverse();
  const summary = agent.summary || {};
  const summaryRows = [
    ["current", summary.current || agent.doing],
    ["last command", summary.lastCommand],
    ["last edit", summary.lastEdit],
    ["last tool", summary.lastTool],
    ["last message", summary.lastMessage],
    ["last prompt", summary.lastPrompt],
  ].filter((entry) => entry[1]);
  const lastEventAt = agent.lastEventAt
    ? new Date(agent.lastEventAt).toLocaleTimeString()
    : null;
  const lastActivityAt = agent.lastActivityAt
    ? new Date(agent.lastActivityAt).toLocaleTimeString()
    : null;
  const activityReason = agent.activityReason;
  const showMetadata = searchQuery.trim().length > 0;
  panelContent.innerHTML = `
    <div class="panel-section">
      <h4>Identity</h4>
      <div class="panel-list">
        <div><span class="panel-key">name</span>${escapeHtml(labelFor(agent))}</div>
        <div><span class="panel-key">pid</span>${escapeHtml(agent.pid)}</div>
        <div><span class="panel-key">kind</span>${escapeHtml(agent.kind)}</div>
        <div><span class="panel-key">state</span>${escapeHtml(agent.state)}</div>
        ${agent.startedAt ? `<div><span class="panel-key">started</span>${escapeHtml(new Date(agent.startedAt * 1000).toLocaleString())}</div>` : ""}
      </div>
    </div>
    <div class="panel-section">
      <h4>Work</h4>
      <div class="panel-list">
        ${
          summaryRows.length
            ? summaryRows
                .map(
                  ([label, value]) =>
                    `<div><span class="panel-key">${escapeHtml(label)}</span>${escapeHtml(value)}</div>`
                )
                .join("")
            : "<div>-</div>"
        }
        ${activityReason ? `<div><span class="panel-key">activity reason</span>${escapeHtml(activityReason)}</div>` : ""}
        ${lastActivityAt ? `<div><span class="panel-key">last activity</span>${escapeHtml(lastActivityAt)}</div>` : ""}
        ${lastEventAt ? `<div><span class="panel-key">last event</span>${escapeHtml(lastEventAt)}</div>` : ""}
        <div><span class="panel-key">cpu</span>${escapeHtml(formatPercent(agent.cpu))}</div>
        <div><span class="panel-key">mem</span>${escapeHtml(formatBytes(agent.mem))}</div>
      </div>
    </div>
    ${
      showMetadata
        ? `
    <div class="panel-section">
      <h4>Metadata</h4>
      <div class="panel-list">
        <div><span class="panel-key">repo</span>${escapeHtml(agent.repo || "-")}</div>
        <div><span class="panel-key">cwd</span>${escapeHtml(agent.cwd || "-")}</div>
        <div><span class="panel-key">session</span>${escapeHtml(agent.sessionPath || "-")}</div>
        <div><span class="panel-key">cmd</span>${escapeHtml(agent.cmd || "-")}</div>
        <div><span class="panel-key">model</span>${escapeHtml(agent.model || "-")}</div>
      </div>
    </div>
    `
        : `
    <div class="panel-section">
      <h4>Metadata</h4>
      <div class="panel-list">
        <div>Search to reveal metadata.</div>
      </div>
    </div>
    `
    }
    <div class="panel-section">
      <h4>Recent Events</h4>
      <div class="panel-list">
        ${
          orderedEvents.length
            ? orderedEvents
                .map((ev) => {
                  const time = new Date(ev.ts).toLocaleTimeString();
                  return `<div>[${escapeHtml(time)}] ${escapeHtml(truncate(ev.summary, 120))}</div>`;
                })
                .join("")
            : "<div>-</div>"
        }
      </div>
    </div>
  `;
}

panelClose.addEventListener("click", () => {
  selected = null;
  renderPanel(null);
});

function draw() {
  flushPendingSnapshot();
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  ctx.clearRect(0, 0, canvas.width / deviceScale, canvas.height / deviceScale);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  if (!agents.length) {
    ctx.fillStyle = "rgba(228, 230, 235, 0.6)";
    ctx.font = "16px Space Grotesk";
    ctx.textAlign = "center";
  ctx.fillText("No codex processes found", 0, 0);
  ctx.restore();
  requestAnimationFrame(draw);
  return;
  }

  updateLayout(agents);
  if (selected) {
    ensureSelectedVisible(selected);
  }

  const drawList = agents
    .map((agent) => {
      const key = keyForAgent(agent);
      const coord = layout.get(key) || { x: 0, y: 0 };
      const screen = isoToScreen(coord.x, coord.y, tileW, tileH);
      return { agent, key, coord, screen };
    })
    .sort((a, b) => a.coord.x + a.coord.y - (b.coord.x + b.coord.y));

  const activeAgents = drawList
    .filter((item) => item.agent.state !== "idle")
    .sort((a, b) => b.agent.cpu - a.agent.cpu);
  const topActiveIds = new Set(
    activeAgents.slice(0, 4).map((item) => agentIdentity(item.agent))
  );

  const time = Date.now();
  const hitList = [];
  const roofList = [];
  const obstructedIds = new Set();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const item of drawList) {
    const palette = paletteFor(item.agent);
    const memMB = item.agent.mem / (1024 * 1024);
    const heightBase = Math.min(120, Math.max(18, memMB * 0.4));
    const isActive = item.agent.state === "active";
    const isServer = isServerKind(item.agent.kind);
    const accent = accentFor(item.agent);
    const accentStrong = accentStrongFor(item.agent);
    const accentSoft = accentSoftFor(item.agent);
    const pulse =
      isActive && !reducedMotion
        ? 4 + Math.sin(time / 200) * 3
        : 0;
    const pulsePhase =
      isActive && !reducedMotion
        ? (Math.sin(time / 240) + 1) / 2
        : 0;
    const idleScale = item.agent.state === "idle" ? 0.6 : 1;
    const height = heightBase * idleScale + pulse;

    const x = item.screen.x;
    const y = item.screen.y;

    ctx.globalAlpha = stateOpacity[item.agent.state] ?? 1;
    drawBuilding(ctx, x, y, tileW, tileH, height, palette);
    drawDiamond(ctx, x, y, tileW, tileH, "rgba(16, 22, 28, 0.8)", "#3e4e59");
    ctx.globalAlpha = 1;

    const roofY = y - height - tileH * 0.15;

    if (isActive) {
      const glowAlpha = 0.12 + pulsePhase * 0.22;
      ctx.save();
      drawDiamond(
        ctx,
        x,
        y + tileH * 0.02,
        tileW * 0.92,
        tileH * 0.46,
        accentGlow(item.agent, glowAlpha),
        null
      );
      ctx.restore();
    }

    if (selected && agentIdentity(selected) === agentIdentity(item.agent)) {
      drawDiamond(ctx, x, y, tileW + 10, tileH + 6, "rgba(0,0,0,0)", accent);
    }

    ctx.fillStyle = "rgba(10, 12, 15, 0.6)";
    ctx.beginPath();
    ctx.ellipse(x, y + tileH * 0.7, tileW * 0.4, tileH * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    const isHovered = hovered && agentIdentity(hovered) === agentIdentity(item.agent);
    const isSelected = selected && agentIdentity(selected) === agentIdentity(item.agent);
    const showActiveTag = topActiveIds.has(agentIdentity(item.agent));
    if (isHovered || isSelected) {
      const label = truncate(labelFor(item.agent), 20);
      drawTag(ctx, x, y - height - tileH * 0.6, label, accentStrong);
      const doing = truncate(item.agent.summary?.current || item.agent.doing || "", 36);
      drawTag(ctx, x, y - height - tileH * 0.9, doing, accentSoft);
      if (isServer) {
        drawTag(ctx, x, y + tileH * 0.2, "server", "rgba(79, 107, 122, 0.6)");
      }
    } else if (showActiveTag) {
      const doing = truncate(
        item.agent.summary?.current || item.agent.doing || labelFor(item.agent),
        32
      );
      drawTag(ctx, x, y - height - tileH * 0.7, doing, accentSoft);
      if (isServer) {
        drawTag(ctx, x, y + tileH * 0.2, "server", "rgba(79, 107, 122, 0.6)");
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
    });
  }

  for (const a of hitList) {
    const roofPoint = { x: a.x, y: a.roofY };
    for (const b of hitList) {
      if (a === b) continue;
      const topY = b.y - b.height;
      const halfW = tileW / 2;
      const halfH = tileH / 2;
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
      item.markerY = item.roofY - markerOffset;
    }
  }

  for (const item of roofList) {
    const roofAlpha = 1;
    ctx.save();
    ctx.globalAlpha = roofAlpha;
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
      drawDiamond(
        ctx,
        item.x,
        item.y,
        selectedRoofW,
        selectedRoofH,
        "rgba(0,0,0,0)",
        item.accent
      );
    }

    if (obstructedIds.has(item.identity)) {
      drawDiamond(
        ctx,
        item.x,
        item.y - markerOffset,
        markerW,
        markerH,
        "rgba(0,0,0,0)",
        item.accentStrong
      );
    }
  }

  ctx.restore();

  canvas._hitList = hitList;
  requestAnimationFrame(draw);
}

function screenToWorld(x, y) {
  return {
    x: (x - view.x) / view.scale,
    y: (y - view.y) / view.scale,
  };
}

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const pos = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  const hitList = canvas._hitList || [];
  let found = null;
  for (let i = hitList.length - 1; i >= 0; i -= 1) {
    const item = hitList[i];
    if (!item.markerY) continue;
    if (pointInDiamond(pos.x, pos.y, item.x, item.markerY, markerW, markerH)) {
      found = item.agent;
      break;
    }
  }
  if (!found) {
    for (let i = hitList.length - 1; i >= 0; i -= 1) {
      const item = hitList[i];
      if (
        pointInDiamond(
          pos.x,
          pos.y,
          item.x,
          item.roofY,
          item.roofHitW || roofHitW,
          item.roofHitH || roofHitH
        )
      ) {
        found = item.agent;
        break;
      }
    }
  }
  if (!found) {
    for (let i = hitList.length - 1; i >= 0; i -= 1) {
      const item = hitList[i];
      if (pointInDiamond(pos.x, pos.y, item.x, item.y, tileW, tileH)) {
        found = item.agent;
        break;
      }
    }
  }
  hovered = found;
  if (hovered) {
    tooltip.classList.remove("hidden");
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${event.clientY}px`;
    const doing = truncate(hovered.summary?.current || hovered.doing || hovered.cmdShort || "", 120);
    tooltip.textContent = `${labelFor(hovered)} | ${doing}`;
  } else {
    tooltip.classList.add("hidden");
  }
});

canvas.addEventListener("mouseleave", () => {
  hovered = null;
  tooltip.classList.add("hidden");
});

canvas.addEventListener("click", () => {
  if (hovered) {
    selected = hovered;
    renderPanel(selected);
  }
});

canvas.addEventListener("mousedown", (event) => {
  view.dragging = true;
  view.lastX = event.clientX;
  view.lastY = event.clientY;
});

window.addEventListener("mouseup", () => {
  view.dragging = false;
});

window.addEventListener("mousemove", (event) => {
  if (!view.dragging) return;
  const dx = event.clientX - view.lastX;
  const dy = event.clientY - view.lastY;
  view.x += dx;
  view.y += dy;
  view.lastX = event.clientX;
  view.lastY = event.clientY;
});

if (searchInput) {
  searchInput.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    searchQuery = target.value || "";
    scheduleSnapshot({ agents, ts: Date.now(), meta: latestMeta });
  });
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const delta = Math.sign(event.deltaY) * -0.1;
    view.scale = Math.min(2.5, Math.max(0.4, view.scale + delta));
  },
  { passive: false }
);

canvas.addEventListener("keydown", (event) => {
  const panStep = 24;
  switch (event.key) {
    case "ArrowUp":
      view.y += panStep;
      event.preventDefault();
      break;
    case "ArrowDown":
      view.y -= panStep;
      event.preventDefault();
      break;
    case "ArrowLeft":
      view.x += panStep;
      event.preventDefault();
      break;
    case "ArrowRight":
      view.x -= panStep;
      event.preventDefault();
      break;
    case "+":
    case "=":
      view.scale = Math.min(2.5, view.scale + 0.1);
      event.preventDefault();
      break;
    case "-":
      view.scale = Math.max(0.4, view.scale - 0.1);
      event.preventDefault();
      break;
    default:
      break;
  }
});

function connect() {
  const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = wsOverride || `${wsProtocol}://${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    setStatus("live");
    wsLastMessageAt = Date.now();
    if (wsHealthTimer) clearInterval(wsHealthTimer);
    wsHealthTimer = setInterval(() => {
      if (Date.now() - wsLastMessageAt > WS_STALE_MS) {
        setStatus("stale");
      }
    }, 1000);
    const hello = {
      v: 1,
      t: "hello",
      role: "viewer",
      enc: "json",
      lastSeq: ledgerSeq || undefined,
    };
    try {
      ws.send(JSON.stringify(hello));
    } catch {
      // ignore send errors
    }
  });

  ws.addEventListener("message", (event) => {
    wsLastMessageAt = Date.now();
    const handlePayload = (text) => {
      try {
        const payload = JSON.parse(text);
        if (payload && payload.v === 1 && typeof payload.t === "string") {
          if (payload.t === "welcome") return;
          if (payload.t === "snapshot") {
            ingestSnapshot(payload.data || {}, payload.seq || 0);
            if (wsStatus !== "live") {
              setStatus("live");
            }
            return;
          }
          if (payload.t === "delta") {
            applyDeltaOps(payload.ops || [], payload.seq || 0);
            if (wsStatus !== "live") {
              setStatus("live");
            }
            return;
          }
          if (payload.t === "ping") {
            ws.send(JSON.stringify({ v: 1, t: "pong", ts: Date.now() }));
            return;
          }
        }
        const seq = ++wsSeq;
        ingestSnapshot(payload, 0, seq);
        if (wsStatus !== "live") {
          setStatus("live");
        }
      } catch {
        setStatus("error");
      }
    };
    if (typeof event.data === "string") {
      handlePayload(event.data);
      return;
    }
    if (event.data instanceof Blob) {
      event.data.text().then(handlePayload).catch(() => setStatus("error"));
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      const text = new TextDecoder().decode(new Uint8Array(event.data));
      handlePayload(text);
      return;
    }
    setStatus("error");
  });

  ws.addEventListener("close", () => {
    setStatus("disconnected");
    if (wsHealthTimer) {
      clearInterval(wsHealthTimer);
      wsHealthTimer = null;
    }
    setTimeout(connect, 1000);
  });

  ws.addEventListener("error", () => {
    setStatus("error");
  });
}

function ingestSnapshot(payload, seq = 0, renderSeq = seq) {
  if (seq && seq <= ledgerSeq) return;
  if (seq) ledgerSeq = seq;
  ledgerTs = typeof payload.ts === "number" ? payload.ts : Date.now();
  ledgerMeta = payload.meta || {};
  ledgerAgents.clear();
  const incomingAgents = Array.isArray(payload.agents) ? payload.agents : [];
  for (const agent of incomingAgents) {
    if (!agent) continue;
    ledgerAgents.set(String(agentIdentity(agent)), agent);
  }
  scheduleSnapshot(
    { ts: ledgerTs, agents: Array.from(ledgerAgents.values()), meta: ledgerMeta },
    renderSeq
  );
}

function applyDeltaOps(ops, seq = 0) {
  if (seq && seq <= ledgerSeq) return;
  if (seq) ledgerSeq = seq;
  if (Array.isArray(ops)) {
    for (const entry of ops) {
      const op = entry && entry.op;
      if (op === "upsert" && entry.value) {
        const id = entry.id ?? agentIdentity(entry.value);
        ledgerAgents.set(String(id), entry.value);
        continue;
      }
      if (op === "remove") {
        ledgerAgents.delete(String(entry.id));
        continue;
      }
      if (op === "meta") {
        ledgerMeta = entry.value || {};
        continue;
      }
      if (op === "ts") {
        const ts = Number(entry.value);
        if (Number.isFinite(ts)) {
          ledgerTs = ts;
        }
      }
    }
  }
  const ts = ledgerTs || Date.now();
  scheduleSnapshot(
    { ts, agents: Array.from(ledgerAgents.values()), meta: ledgerMeta },
    seq
  );
}

function applySnapshot(payload) {
  const incomingAgents = Array.isArray(payload.agents) ? payload.agents : [];
  agents = dedupeAgentsByIdentity(incomingAgents).map((agent) => ({
    ...agent,
    state: normalizeState(agent.state),
  }));
  latestMeta = payload.meta || {};
  renderStatus();
  const serverAgents = agents.filter((agent) => isServerKind(agent.kind));
  const agentNodes = agents.filter((agent) => !isServerKind(agent.kind));
  setCount(agentNodes.length, serverAgents.length);
  const query = searchQuery.trim().toLowerCase();
  searchMatches = new Set(
    query
      ? agents
          .filter((agent) => matchesQuery(agent, query))
          .map((agent) => agentIdentity(agent))
      : []
  );
  const visibleAgents = query
    ? agents.filter((agent) => searchMatches.has(agentIdentity(agent)))
    : agents;
  const listAgents = visibleAgents.filter((agent) => !isServerKind(agent.kind));
  const listServers = query
    ? visibleAgents.filter((agent) => isServerKind(agent.kind))
    : visibleAgents.filter((agent) => isServerKind(agent.kind));
  if (laneTitle) {
    laneTitle.textContent = query ? "search results" : "agents";
  }
  if (serverTitle) {
    serverTitle.textContent = query ? "server results" : "servers";
  }
  renderLaneList(listAgents, activeList, "No agents detected.");
  renderLaneList(listServers, serverList, "No servers detected.");
  if (selected) {
    const selectedKey = agentIdentity(selected);
    selected = agents.find((agent) => agentIdentity(agent) === selectedKey) || selected;
    renderPanel(selected);
  }
}

function flushPendingSnapshot() {
  if (!pendingSnapshot) return;
  const next = pendingSnapshot;
  const nextSeq = pendingSnapshotSeq;
  pendingSnapshot = null;
  pendingSnapshotSeq = 0;
  if (nextSeq && nextSeq < lastAppliedSeq) return;
  if (nextSeq) lastAppliedSeq = nextSeq;
  applySnapshot(next);
}

function scheduleSnapshot(payload, seq = 0) {
  if (seq && seq < lastAppliedSeq) return;
  if (seq && pendingSnapshotSeq && seq < pendingSnapshotSeq) return;
  pendingSnapshot = payload;
  pendingSnapshotSeq = seq;
}

if (mockMode) {
  setStatus("mock");
  window.__consensusMock = {
    setSnapshot: (snapshot) => scheduleSnapshot(snapshot || {}),
    setAgents: (nextAgents) =>
      scheduleSnapshot({ agents: nextAgents || [], ts: Date.now() }),
    getAgents: () => agents,
    setLayout: (positions) => {
      if (!Array.isArray(positions)) return;
      layout.clear();
      occupied.clear();
      layoutLocked = true;
      const byIdentity = new Map(
        agents.map((agent) => [String(agentIdentity(agent)), agent])
      );
      const byPid = new Map(
        agents
          .filter((agent) => typeof agent.pid === "number")
          .map((agent) => [String(agent.pid), agent])
      );
      for (const entry of positions) {
        const keyId = entry?.id ?? entry?.pid;
        if (keyId === undefined || keyId === null) continue;
        const agent =
          byIdentity.get(String(keyId)) || byPid.get(String(keyId)) || null;
        if (!agent) continue;
        const key = keyForAgent(agent);
        const coord = { x: Number(entry.x) || 0, y: Number(entry.y) || 0 };
        layout.set(key, coord);
        occupied.set(`${coord.x / gridScale},${coord.y / gridScale}`, key);
      }
    },
    unlockLayout: () => {
      layoutLocked = false;
    },
    getHitList: () => canvas._hitList || [],
    getView: () => ({ x: view.x, y: view.y, scale: view.scale }),
  };
} else {
  connect();
}
renderPanel(null);
requestAnimationFrame(draw);
