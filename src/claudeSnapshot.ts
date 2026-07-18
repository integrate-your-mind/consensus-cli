import type { AgentSnapshot, SnapshotPayload, WorkSummary } from "./types.js";
import {
  getClaudeActivityByCwd,
  getClaudeActivityBySession,
} from "./services/claudeEvents.js";

function claudeSessionId(agent: AgentSnapshot): string | undefined {
  for (const candidate of [agent.sessionPath, agent.identity]) {
    if (!candidate?.startsWith("claude:")) continue;
    const sessionId = candidate.slice("claude:".length).trim();
    if (sessionId) return sessionId;
  }
  return undefined;
}

function mergeSummary(
  existing: WorkSummary | undefined,
  observed: WorkSummary | undefined
): WorkSummary | undefined {
  if (!existing && !observed) return undefined;
  return { ...(existing ?? {}), ...(observed ?? {}) };
}

export function attachClaudeEvents(snapshot: SnapshotPayload): SnapshotPayload {
  const agents = snapshot.agents.map((agent) => {
    if (!agent.kind.startsWith("claude")) return agent;

    const sessionId = claudeSessionId(agent);
    const state =
      (sessionId ? getClaudeActivityBySession(sessionId, snapshot.ts) : undefined) ??
      (agent.cwd ? getClaudeActivityByCwd(agent.cwd, snapshot.ts) : undefined);
    if (!state) return agent;

    const summary = mergeSummary(agent.summary, state.summary);
    return {
      ...agent,
      state: state.hasError ? "error" : agent.state,
      lastEventAt:
        typeof state.lastEventAt === "number"
          ? Math.max(agent.lastEventAt ?? 0, state.lastEventAt)
          : agent.lastEventAt,
      lastActivityAt: state.lastActivityAt ?? agent.lastActivityAt,
      doing: summary?.current ?? agent.doing,
      summary,
      events: state.events.slice(-20),
    };
  });

  return { ...snapshot, agents };
}
