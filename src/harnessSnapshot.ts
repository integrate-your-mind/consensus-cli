import {
  harnessIdForKind,
  type HarnessId,
} from "./harnesses.js";
import {
  isHookHarnessId,
  type HookHarnessId,
} from "./harnessHookModel.js";
import {
  listHarnessActivity,
  type HarnessSessionState,
} from "./services/harnessEvents.js";
import type {
  AgentSnapshot,
  EventSummary,
  SnapshotPayload,
  WorkSummary,
} from "./types.js";

const MAX_EVENTS = 50;

function eventKey(event: EventSummary): string {
  return JSON.stringify([
    event.ts,
    event.type,
    event.summary,
    event.isError === true,
    event.turnId ?? null,
  ]);
}

function mergeEvents(
  existing: EventSummary[] | undefined,
  observed: EventSummary[]
): EventSummary[] {
  const seen = new Set<string>();
  return [...(existing ?? []), ...observed]
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.event.ts - b.event.ts || a.index - b.index)
    .slice(-MAX_EVENTS)
    .map(({ event }) => event);
}

function summaryFromEvents(
  existing: WorkSummary | undefined,
  events: EventSummary[]
): WorkSummary | undefined {
  if (!existing && events.length === 0) return undefined;
  const summary: WorkSummary = { ...(existing ?? {}) };
  for (const event of events) {
    if (event.summary === "prompt" || event.summary.startsWith("prompt:")) {
      summary.lastPrompt = event.summary;
    }
    if (event.summary === "message") summary.lastMessage = event.summary;
    if (event.summary.startsWith("tool:")) summary.lastTool = event.summary;
    if (event.summary.startsWith("cmd:")) summary.lastCommand = event.summary;
    if (event.summary.startsWith("edit:")) summary.lastEdit = event.summary;
    if (!event.summary.startsWith("event:")) summary.current = event.summary;
  }
  return summary;
}

function maxDefined(
  left: number | undefined,
  right: number | undefined
): number | undefined {
  if (typeof left !== "number") return right;
  if (typeof right !== "number") return left;
  return Math.max(left, right);
}

function stateForHarnessSession(
  state: HarnessSessionState
): AgentSnapshot["state"] {
  if (state.hasError) return "error";
  return state.inFlight ? "active" : "idle";
}

function selectState(
  agent: AgentSnapshot,
  states: HarnessSessionState[],
  singleAgent: boolean
): HarnessSessionState | undefined {
  if (agent.harnessSessionKey) {
    const exact = states.find(
      (state) => state.sessionKey === agent.harnessSessionKey
    );
    if (exact) return exact;
  }
  if (agent.harnessCwdKey) {
    const cwdMatches = states.filter(
      (state) => state.cwdKey === agent.harnessCwdKey
    );
    if (cwdMatches.length === 1) return cwdMatches[0];
    if (cwdMatches.length > 1) return undefined;
  }
  return singleAgent && states.length === 1 ? states[0] : undefined;
}

function attachState(
  agent: AgentSnapshot,
  state: HarnessSessionState
): AgentSnapshot {
  const events = mergeEvents(agent.events, state.events);
  const summary = summaryFromEvents(agent.summary, events);
  const hookIsCurrent = state.lastSeenAt >= (agent.lastEventAt ?? 0);
  const nextState = hookIsCurrent ? stateForHarnessSession(state) : agent.state;
  return {
    ...agent,
    state: nextState,
    activityReason: hookIsCurrent
      ? nextState === "error"
        ? "harness_hook_error"
        : nextState === "active"
          ? "harness_hook_in_flight"
          : "harness_hook_idle"
      : agent.activityReason,
    lastEventAt: maxDefined(agent.lastEventAt, state.lastSeenAt),
    lastActivityAt:
      hookIsCurrent && nextState === "idle"
        ? undefined
        : maxDefined(agent.lastActivityAt, state.lastActivityAt),
    doing: summary?.current ?? agent.doing,
    summary,
    events,
    harnessSessionKey: state.sessionKey,
    harnessCwdKey: state.cwdKey ?? agent.harnessCwdKey,
  };
}

export function attachHarnessEvents(snapshot: SnapshotPayload): SnapshotPayload {
  const agentsByHarness = new Map<HookHarnessId, AgentSnapshot[]>();
  for (const agent of snapshot.agents) {
    const harnessId: HarnessId = harnessIdForKind(agent.kind);
    if (!isHookHarnessId(harnessId)) continue;
    const current = agentsByHarness.get(harnessId) ?? [];
    current.push(agent);
    agentsByHarness.set(harnessId, current);
  }
  if (agentsByHarness.size === 0) return snapshot;

  const stateByIdentity = new Map<string, HarnessSessionState>();
  for (const [harnessId, agents] of agentsByHarness) {
    const states = listHarnessActivity(harnessId, snapshot.ts);
    const singleAgent = agents.length === 1;
    const claimedSessions = new Set<string>();

    for (const agent of agents) {
      const selected = selectState(
        agent,
        states.filter((state) => !claimedSessions.has(state.sessionKey)),
        singleAgent
      );
      if (!selected) continue;
      claimedSessions.add(selected.sessionKey);
      stateByIdentity.set(agent.identity || agent.id, selected);
    }
  }

  if (stateByIdentity.size === 0) return snapshot;
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) => {
      const state = stateByIdentity.get(agent.identity || agent.id);
      return state ? attachState(agent, state) : agent;
    }),
  };
}
