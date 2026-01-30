import type { AgentSnapshot } from '../types';
import { labelFor, truncate } from '../lib/format';

interface TooltipProps {
  agent: AgentSnapshot | null;
  x: number;
  y: number;
}

export function Tooltip({ agent, x, y }: TooltipProps) {
  if (!agent) return null;

  const doing = truncate(
    agent.summary?.current || agent.doing || agent.cmdShort || '',
    120
  );

  return (
    <div
      id="tooltip"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        position: 'absolute',
      }}
    >
      {labelFor(agent)} | {doing}
    </div>
  );
}
