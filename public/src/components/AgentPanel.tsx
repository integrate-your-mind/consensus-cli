import type { AgentSnapshot } from '../types';
import {
  labelFor,
  formatBytes,
  formatPercent,
  formatDate,
  formatDateFull,
} from '../lib/format';

interface AgentPanelProps {
  agent: AgentSnapshot | null;
  showMetadata: boolean;
  onClose: () => void;
}

export function AgentPanel({ agent, showMetadata, onClose }: AgentPanelProps) {
  if (!agent) {
    return (
      <aside id="panel" className="collapsed" aria-label="Agent details">
        <div className="panel-content" />
      </aside>
    );
  }

  const events = agent.events || [];
  const orderedEvents = [...events].reverse();
  const summary = agent.summary || {};
  
  const summaryRows = [
    ['current', summary.current || agent.doing],
    ['last command', summary.lastCommand],
    ['last edit', summary.lastEdit],
    ['last tool', summary.lastTool],
    ['last message', summary.lastMessage],
    ['last prompt', summary.lastPrompt],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  const lastEventAt = formatDate(agent.lastEventAt);
  const lastActivityAt = formatDate(agent.lastActivityAt);
  const startedAt = formatDateFull(agent.startedAt);

  return (
    <aside id="panel" className="open" aria-label="Agent details">
      <div className="panel-header">
        <div className="panel-title">agent</div>
        <button id="panel-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      
      <div id="panel-content">
        <div className="panel-section">
          <h4>Identity</h4>
          <div className="panel-list">
            <div>
              <span className="panel-key">name</span>
              {labelFor(agent)}
            </div>
            <div>
              <span className="panel-key">pid</span>
              {agent.pid}
            </div>
            <div>
              <span className="panel-key">kind</span>
              {agent.kind}
            </div>
            <div>
              <span className="panel-key">state</span>
              {agent.state}
            </div>
            {startedAt && (
              <div>
                <span className="panel-key">started</span>
                {startedAt}
              </div>
            )}
          </div>
        </div>

        <div className="panel-section">
          <h4>Work</h4>
          <div className="panel-list">
            {summaryRows.length > 0 ? (
              summaryRows.map(([label, value]) => (
                <div key={label}>
                <span className="panel-key">{label}</span>
                {value}
                </div>
              ))
            ) : (
              <div>-</div>
            )}
            {agent.activityReason && (
              <div>
                <span className="panel-key">activity reason</span>
                {agent.activityReason}
              </div>
            )}
            {lastActivityAt && (
              <div>
                <span className="panel-key">last activity</span>
                {lastActivityAt}
              </div>
            )}
            {lastEventAt && (
              <div>
                <span className="panel-key">last event</span>
                {lastEventAt}
              </div>
            )}
            <div>
              <span className="panel-key">cpu</span>
              {formatPercent(agent.cpu)}
            </div>
            <div>
              <span className="panel-key">mem</span>
              {formatBytes(agent.mem)}
            </div>
          </div>
        </div>

        {showMetadata ? (
          <div className="panel-section">
            <h4>Metadata</h4>
            <div className="panel-list">
              <div>
                <span className="panel-key">repo</span>
                {agent.repo || '-'}
              </div>
              <div>
                <span className="panel-key">cwd</span>
                {agent.cwd || '-'}
              </div>
              <div>
                <span className="panel-key">session</span>
                {agent.sessionPath || '-'}
              </div>
              <div>
                <span className="panel-key">cmd</span>
                {agent.cmd || '-'}
              </div>
              <div>
                <span className="panel-key">model</span>
                {agent.model || '-'}
              </div>
            </div>
          </div>
        ) : (
          <div className="panel-section">
            <h4>Metadata</h4>
            <div className="panel-list">
              <div>Search to reveal metadata.</div>
            </div>
          </div>
        )}

        <div className="panel-section">
          <h4>Recent Events</h4>
          <div className="panel-list">
            {orderedEvents.length > 0 ? (
              orderedEvents.map((ev, i) => {
                const time = new Date(ev.ts).toLocaleTimeString();
                return (
                  <div key={i}>
                    [{time}] {truncate(ev.summary, 120)}
                  </div>
                );
              })
            ) : (
              <div>-</div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
