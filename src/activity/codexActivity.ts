import { summarizeTail, updateTail } from "../codexLogs.js";
import type { AgentStateStore } from "../core/stateStore.js";
import type { AgentKey, AgentMeta } from "../core/events.js";
import { redactText } from "../redact.js";

const sessionAgents = new Map<string, AgentKey>();
const sessionState = new Map<string, { inFlight?: boolean; lastActivityAt?: number }>();

const TURN_SPAN = "turn";

function resolveAgentKey(sessionPath: string): AgentKey {
  return `codex:${sessionPath}`;
}

export function setCodexAgentForSession(sessionPath: string, agent: AgentKey): void {
  if (!sessionPath) return;
  sessionAgents.set(sessionPath, agent);
}

export function removeCodexSession(sessionPath: string): void {
  sessionAgents.delete(sessionPath);
  sessionState.delete(sessionPath);
}

export async function ingestCodexSession(
  store: AgentStateStore,
  sessionPath: string
): Promise<void> {
  if (!sessionPath) return;
  const tail = await updateTail(sessionPath);
  if (!tail) return;
  const summary = summarizeTail(tail);
  const agentKey = sessionAgents.get(sessionPath) || resolveAgentKey(sessionPath);
  sessionAgents.set(sessionPath, agentKey);

  const ts =
    summary.lastIngestAt ?? summary.lastActivityAt ?? summary.lastEventAt ?? Date.now();
  const meta: AgentMeta = {
    identity: agentKey,
    sessionPath: redactText(sessionPath) || sessionPath,
    title: summary.title,
    doing: summary.doing,
    summary: summary.summary,
    events: summary.events,
    model: summary.model,
    hasError: summary.hasError,
    lastEventAt: summary.lastEventAt,
  };

  // Update metadata even when idle.
  store.ingest({ t: "span.progress", agent: agentKey, ts, meta });

  const prev = sessionState.get(sessionPath);
  const wasInFlight = !!prev?.inFlight;
  const isInFlight = !!summary.inFlight;
  const lastActivityAt = summary.lastIngestAt ?? summary.lastActivityAt;

  if (isInFlight && !wasInFlight) {
    store.ingest({
      t: "span.start",
      agent: agentKey,
      ts,
      span: TURN_SPAN,
      kind: "turn",
      meta,
    });
  }
  if (!isInFlight && wasInFlight) {
    store.ingest({
      t: "span.end",
      agent: agentKey,
      ts,
      span: TURN_SPAN,
      kind: "turn",
      meta,
    });
  }
  if (isInFlight && lastActivityAt && lastActivityAt !== prev?.lastActivityAt) {
    store.ingest({
      t: "span.progress",
      agent: agentKey,
      ts,
      span: TURN_SPAN,
      kind: "turn",
      meta,
    });
  }

  sessionState.set(sessionPath, { inFlight: isInFlight, lastActivityAt });
}
