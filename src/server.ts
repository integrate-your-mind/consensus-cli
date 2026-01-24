import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "url";
import { scanCodexProcesses } from "./scan.js";
import type { SnapshotPayload } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const port = Number(process.env.CONSENSUS_PORT || 8787);
const host = process.env.CONSENSUS_HOST || "127.0.0.1";
const pollMs = Math.max(250, Number(process.env.CONSENSUS_POLL_MS || 1000));

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

app.get("/api/snapshot", async (_req, res) => {
  try {
    const snapshot = await scanCodexProcesses();
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "scan_failed" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

let lastSnapshot: SnapshotPayload = { ts: Date.now(), agents: [] };
let scanning = false;

async function tick(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    lastSnapshot = await scanCodexProcesses();
    const payload = JSON.stringify(lastSnapshot);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  } catch (err) {
    // Keep server alive on scan errors.
  } finally {
    scanning = false;
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify(lastSnapshot));
});

setInterval(tick, pollMs);

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  process.stdout.write(`consensus dev server running on ${url}\n`);
});

tick().catch(() => {
  // initial scan failure is non-fatal
});
