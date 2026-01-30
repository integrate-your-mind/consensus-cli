import type { AgentSnapshot, SnapshotMeta } from '../types';

type MockSnapshot = {
  agents?: AgentSnapshot[];
  ts?: number;
  meta?: SnapshotMeta;
};

type MockQueueItem =
  | { type: 'snapshot'; snapshot: MockSnapshot }
  | { type: 'agents'; agents: AgentSnapshot[] };

const mockQueue: MockQueueItem[] = [];

export function initMockBridge(): void {
  const win = window as any;
  if (win.__consensusMock) return;
  win.__consensusMock = {
    setSnapshot: (snapshot: MockSnapshot) => {
      mockQueue.push({ type: 'snapshot', snapshot: snapshot || {} });
    },
    setAgents: (agents: AgentSnapshot[]) => {
      mockQueue.push({ type: 'agents', agents: agents || [] });
    },
    getAgents: () => [],
    getHitList: () => [],
    getView: () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }),
  };
  win.__consensusMockQueue = mockQueue;
}

export function attachMockBridge(handlers: {
  setSnapshot: (snapshot: MockSnapshot) => void;
  setAgents: (agents: AgentSnapshot[]) => void;
  getAgents: () => AgentSnapshot[];
}): void {
  const win = window as any;
  win.__consensusMock = { ...(win.__consensusMock || {}), ...handlers };
  const queue = win.__consensusMockQueue as MockQueueItem[] | undefined;
  if (!Array.isArray(queue) || queue.length === 0) return;
  const pending = queue.splice(0, queue.length);
  for (const entry of pending) {
    if (entry.type === 'snapshot') {
      handlers.setSnapshot(entry.snapshot);
    } else {
      handlers.setAgents(entry.agents);
    }
  }
}
