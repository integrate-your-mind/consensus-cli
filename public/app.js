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
const searchInput = document.getElementById("search");
const laneTitle = document.querySelector(".lane-title");

const tileW = 96;
const tileH = 48;
const gridScale = 2;

const query = new URLSearchParams(window.location.search);
const mockMode = query.get("mock") === "1";

const statePalette = {
  active: { top: "#3d8f7f", left: "#2d6d61", right: "#275b52", stroke: "#54cdb1" },
  idle: { top: "#384a57", left: "#2b3943", right: "#25323b", stroke: "#4f6b7a" },
  error: { top: "#82443c", left: "#6d3530", right: "#5a2c28", stroke: "#d1584b" },
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

const layout = new Map();
const occupied = new Map();

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

function keyForAgent(agent) {
  return agent.repo || agent.cwd || agent.cmd || agent.id;
}

function assignCoordinate(key) {
  const hash = hashString(key);
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
  const activeKeys = new Set();
  for (const agent of newAgents) {
    const key = keyForAgent(agent);
    activeKeys.add(key);
    if (!layout.has(key)) {
      assignCoordinate(key);
    }
  }

  for (const [key, coord] of layout.entries()) {
    if (!activeKeys.has(key)) {
      layout.delete(key);
      occupied.delete(`${coord.x},${coord.y}`);
    }
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setCount(count) {
  countEl.textContent = `${count} agent${count === 1 ? "" : "s"}`;
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

function renderActiveList(items) {
  if (!activeList) return;
  if (!items.length) {
    activeList.innerHTML = "<div class=\"lane-meta\">No active agents.</div>";
    return;
  }
  const sorted = [...items].sort((a, b) => {
    const rank = { error: 0, active: 1, idle: 2 };
    const rankA = rank[a.state] ?? 3;
    const rankB = rank[b.state] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    return b.cpu - a.cpu;
  });

  activeList.innerHTML = sorted
    .map((agent) => {
      const doingRaw = agent.summary?.current || agent.doing || agent.cmdShort || "";
      const doing = escapeHtml(truncate(doingRaw, 80));
      const selectedClass = selected && selected.id === agent.id ? "is-selected" : "";
      const label = escapeHtml(labelFor(agent));
      return `
        <button class="lane-item ${selectedClass}" type="button" data-id="${agent.id}">
          <div class="lane-pill ${agent.state}"></div>
          <div class="lane-copy">
            <div class="lane-label">${label}</div>
            <div class="lane-meta">${doing}</div>
          </div>
        </button>
      `;
    })
    .join("");

  Array.from(activeList.querySelectorAll(".lane-item")).forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.getAttribute("data-id");
      selected = sorted.find((agent) => agent.id === id) || null;
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
  const topActiveIds = new Set(activeAgents.slice(0, 4).map((item) => item.agent.id));

  const time = Date.now();
  const hitList = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const item of drawList) {
    const palette = statePalette[item.agent.state] || statePalette.idle;
    const memMB = item.agent.mem / (1024 * 1024);
    const heightBase = Math.min(120, Math.max(18, memMB * 0.4));
    const pulse =
      item.agent.state === "active" && !reducedMotion
        ? 4 + Math.sin(time / 200) * 3
        : 0;
    const idleScale = item.agent.state === "idle" ? 0.6 : 1;
    const height = heightBase * idleScale + pulse;

    const x = item.screen.x;
    const y = item.screen.y;

    ctx.globalAlpha = stateOpacity[item.agent.state] ?? 1;
    drawBuilding(ctx, x, y, tileW, tileH, height, palette);
    drawDiamond(ctx, x, y, tileW, tileH, "rgba(16, 22, 28, 0.8)", "#3e4e59");
    ctx.globalAlpha = 1;

    const roofSize = tileW * 0.28;
    drawDiamond(
      ctx,
      x,
      y - height - tileH * 0.15,
      roofSize,
      roofSize * 0.5,
      palette.stroke,
      null
    );

    if (selected && selected.id === item.agent.id) {
      drawDiamond(ctx, x, y, tileW + 10, tileH + 6, "rgba(0,0,0,0)", "#57f2c6");
    }

    ctx.fillStyle = "rgba(10, 12, 15, 0.6)";
    ctx.beginPath();
    ctx.ellipse(x, y + tileH * 0.7, tileW * 0.4, tileH * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    const isHovered = hovered && hovered.id === item.agent.id;
    const isSelected = selected && selected.id === item.agent.id;
    const showActiveTag = topActiveIds.has(item.agent.id);
    if (isHovered || isSelected) {
      const label = truncate(labelFor(item.agent), 20);
      drawTag(ctx, x, y - height - tileH * 0.6, label, "rgba(87, 242, 198, 0.6)");
      const doing = truncate(item.agent.summary?.current || item.agent.doing || "", 36);
      drawTag(ctx, x, y - height - tileH * 0.9, doing, "rgba(87, 242, 198, 0.35)");
    } else if (showActiveTag) {
      const doing = truncate(
        item.agent.summary?.current || item.agent.doing || labelFor(item.agent),
        32
      );
      drawTag(ctx, x, y - height - tileH * 0.7, doing, "rgba(87, 242, 198, 0.35)");
    }

    hitList.push({
      x,
      y,
      agent: item.agent,
      key: item.key,
    });
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
    if (pointInDiamond(pos.x, pos.y, item.x, item.y, tileW, tileH)) {
      found = item.agent;
      break;
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
    applySnapshot({ agents, ts: Date.now() });
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
  const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws`);

  ws.addEventListener("open", () => {
    setStatus("live");
  });

  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    applySnapshot(payload);
  });

  ws.addEventListener("close", () => {
    setStatus("disconnected");
    setTimeout(connect, 1000);
  });
}

function applySnapshot(payload) {
  agents = payload.agents || [];
  setCount(agents.length);
  const query = searchQuery.trim().toLowerCase();
  searchMatches = new Set(
    query ? agents.filter((agent) => matchesQuery(agent, query)).map((agent) => agent.id) : []
  );
  const visibleAgents = query
    ? agents.filter((agent) => searchMatches.has(agent.id))
    : agents;
  const listAgents = query
    ? visibleAgents
    : visibleAgents.filter((agent) => agent.state !== "idle");
  if (laneTitle) {
    laneTitle.textContent = query ? "search results" : "active agents";
  }
  renderActiveList(listAgents);
  if (selected) {
    selected = agents.find((agent) => agent.id === selected.id) || selected;
    renderPanel(selected);
  }
}

if (mockMode) {
  setStatus("mock");
  window.__consensusMock = {
    setSnapshot: (snapshot) => applySnapshot(snapshot || {}),
    setAgents: (nextAgents) =>
      applySnapshot({ agents: nextAgents || [], ts: Date.now() }),
    getAgents: () => agents,
  };
} else {
  connect();
}
renderPanel(null);
requestAnimationFrame(draw);
