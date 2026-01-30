import type { AgentSnapshot } from '../types';
import { agentIdentity, labelFor, truncate } from '../lib/format';
import { accentFor, accentSoftFor, cliForAgent } from '../lib/palette';

interface AgentListItemProps {
  agent: AgentSnapshot;
  isSelected: boolean;
  onClick: () => void;
}

export function AgentListItem({ agent, isSelected, onClick }: AgentListItemProps) {
  const doingRaw = agent.summary?.current || agent.doing || agent.cmdShort || '';
  const doing = truncate(doingRaw, 80);
  const label = labelFor(agent);
  const accent = accentFor(agent);
  const accentGlow = accentSoftFor(agent);
  const cli = cliForAgent(agent);
  const isActive = agent.state === 'active';
  const id = agentIdentity(agent);

  return (
    <button
      className={`lane-item ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''} cli-${cli}`}
      type="button"
      data-id={id}
      data-testid={`lane-${id}`}
      data-state={agent.state || 'idle'}
      data-active={isActive}
      aria-busy={isActive}
      style={{
        ['--cli-accent' as string]: accent,
        ['--cli-accent-glow' as string]: accentGlow,
      }}
      onClick={onClick}
    >
      <div className={`lane-pill ${agent.state}`} />
      <div className="lane-copy">
        <div className="lane-label">{label}</div>
        <div className="lane-meta">{doing}</div>
      </div>
    </button>
  );
}
