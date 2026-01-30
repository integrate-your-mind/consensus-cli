import { useState, useEffect, useRef, useCallback } from 'react';
import type { 
  AgentSnapshot, 
  SnapshotMeta, 
  WsStatus, 
  DeltaOp,
  WsServerMessage 
} from '../types';
import { agentIdentity } from '../lib/format';
import { normalizeAgents } from '../lib/agents';
import { attachMockBridge } from '../lib/mockBridge';

const WS_STALE_MS = 5000;
const RECONNECT_DELAY = 1000;

interface WebSocketState {
  status: WsStatus;
  agents: AgentSnapshot[];
  meta: SnapshotMeta;
  error: string | null;
}

function isServerMessage(data: unknown): data is WsServerMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'v' in data &&
    (data as { v: number }).v === 1 &&
    't' in data &&
    typeof (data as { t: string }).t === 'string'
  );
}

export function useWebSocket(
  url: string | null,
  options: { mockMode?: boolean } = {}
): WebSocketState {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [meta, setMeta] = useState<SnapshotMeta>({});
  const [error, setError] = useState<string | null>(null);

  const mockMode = options.mockMode === true;
  
  const wsRef = useRef<WebSocket | null>(null);
  const ledgerRef = useRef<Map<string, AgentSnapshot>>(new Map());
  const seqRef = useRef<number>(0);
  const lastMessageRef = useRef<number>(Date.now());
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHealthTimer = useCallback(() => {
    if (healthTimerRef.current) {
      clearInterval(healthTimerRef.current);
      healthTimerRef.current = null;
    }
  }, []);

  const updateAgents = useCallback(() => {
    setAgents(normalizeAgents(Array.from(ledgerRef.current.values())));
  }, []);

  const applyDeltaOps = useCallback((ops: DeltaOp[]) => {
    for (const entry of ops) {
      if (entry.op === 'upsert' && entry.value) {
        const id = entry.id ?? agentIdentity(entry.value);
        ledgerRef.current.set(String(id), entry.value);
      } else if (entry.op === 'remove') {
        ledgerRef.current.delete(String(entry.id));
      } else if (entry.op === 'meta') {
        setMeta(entry.value ?? {});
      }
    }
    updateAgents();
  }, [updateAgents]);

  const connect = useCallback(() => {
    if (!url || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        setStatus('live');
        setError(null);
        lastMessageRef.current = Date.now();
        
        clearHealthTimer();
        healthTimerRef.current = setInterval(() => {
          if (Date.now() - lastMessageRef.current > WS_STALE_MS) {
            setStatus('stale');
          }
        }, 1000);

        const hello = {
          v: 1 as const,
          t: 'hello' as const,
          role: 'viewer' as const,
          enc: 'json' as const,
          lastSeq: seqRef.current || undefined,
        };
        try {
          ws.send(JSON.stringify(hello));
        } catch {
          // ignore send errors
        }
      });

      ws.addEventListener('message', (event) => {
        lastMessageRef.current = Date.now();
        
        const handlePayload = (text: string) => {
          try {
            const payload: unknown = JSON.parse(text);
            
            if (!isServerMessage(payload)) {
              // Legacy format - treat as snapshot
              if (payload && typeof payload === 'object' && 'agents' in payload) {
                const snapshot = payload as { agents: AgentSnapshot[]; ts?: number; meta?: SnapshotMeta };
                ledgerRef.current.clear();
                for (const agent of snapshot.agents ?? []) {
                  if (agent) ledgerRef.current.set(agentIdentity(agent), agent);
                }
                updateAgents();
                setMeta(snapshot.meta ?? {});
              }
              return;
            }

            if (payload.t === 'welcome') return;
            
            if (payload.t === 'snapshot') {
              seqRef.current = payload.seq;
              ledgerRef.current.clear();
              for (const agent of payload.data.agents ?? []) {
                if (agent) ledgerRef.current.set(agentIdentity(agent), agent);
              }
              updateAgents();
              setMeta(payload.data.meta ?? {});
              if (status !== 'live') setStatus('live');
              return;
            }
            
            if (payload.t === 'delta') {
              seqRef.current = payload.seq;
              applyDeltaOps(payload.ops);
              if (status !== 'live') setStatus('live');
              return;
            }
            
            if (payload.t === 'ping') {
              try {
                ws.send(JSON.stringify({ v: 1, t: 'pong', ts: Date.now() }));
              } catch {
                // ignore
              }
            }
          } catch {
            setStatus('error');
            setError('Failed to parse message');
          }
        };

        if (typeof event.data === 'string') {
          handlePayload(event.data);
        } else if (event.data instanceof Blob) {
          event.data.text().then(handlePayload).catch(() => {
            setStatus('error');
            setError('Failed to read blob');
          });
        } else if (event.data instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(new Uint8Array(event.data));
          handlePayload(text);
        }
      });

      ws.addEventListener('close', () => {
        setStatus('disconnected');
        clearHealthTimer();
        wsRef.current = null;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY);
      });

      ws.addEventListener('error', () => {
        setStatus('error');
        setError('WebSocket error');
      });
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [url, applyDeltaOps, clearHealthTimer]);

  const applySnapshot = useCallback(
    (snapshot: { agents?: AgentSnapshot[]; meta?: SnapshotMeta }) => {
      const incomingAgents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
      const nextAgents = normalizeAgents(incomingAgents);
      ledgerRef.current.clear();
      for (const agent of nextAgents) {
        ledgerRef.current.set(agentIdentity(agent), agent);
      }
      updateAgents();
      setMeta(snapshot.meta ?? {});
    },
    [updateAgents]
  );

  const setMockAgents = useCallback(
    (nextAgents: AgentSnapshot[]) => {
      applySnapshot({ agents: nextAgents });
    },
    [applySnapshot]
  );

  const getMockAgents = useCallback(() => {
    return Array.from(ledgerRef.current.values());
  }, []);

  useEffect(() => {
    if (!mockMode) return;
    setStatus('live');
    attachMockBridge({
      setSnapshot: applySnapshot,
      setAgents: setMockAgents,
      getAgents: getMockAgents,
    });
  }, [mockMode, applySnapshot, setMockAgents, getMockAgents]);

  useEffect(() => {
    if (mockMode || !url) return;
    connect();

    return () => {
      clearHealthTimer();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, connect, clearHealthTimer, mockMode]);

  return { status, agents, meta, error };
}
