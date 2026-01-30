import type { WsStatus, SnapshotMeta } from '../types';

interface HUDProps {
  status: WsStatus;
  agentCount: number;
  serverCount: number;
  meta: SnapshotMeta;
}

export function HUD({ status, agentCount, serverCount, meta }: HUDProps) {
  const getStatusText = (): string => {
    const suffixes: string[] = [];
    const opencode = meta?.opencode;
    
    if (opencode && opencode.ok === false) {
      if (opencode.reachable === false) {
        suffixes.push('OpenCode API unreachable');
      } else if (opencode.error === 'non_json') {
        suffixes.push('OpenCode API bad response');
      } else if (typeof opencode.status === 'number') {
        suffixes.push(`OpenCode API ${opencode.status}`);
      } else if (opencode.error) {
        suffixes.push(`OpenCode API ${opencode.error}`);
      } else {
        suffixes.push('OpenCode API error');
      }
    }

    if ((status === 'live' || status === 'stale') && suffixes.length) {
      return `${status} • ${suffixes.join(' • ')}`;
    }
    return status;
  };

  const agentLabel = `${agentCount} agent${agentCount === 1 ? '' : 's'}`;
  const serverLabel = `${serverCount} server${serverCount === 1 ? '' : 's'}`;

  return (
    <div className="hud">
      <div className="brand">
        <div className="title">consensus</div>
        <div className="subtitle">codex process atlas</div>
      </div>
      <div className="meta" aria-live="polite">
        <div>{getStatusText()}</div>
        <div>
          {agentLabel} • {serverLabel}
        </div>
      </div>
    </div>
  );
}
