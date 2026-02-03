import type { AgentSnapshot } from '../types';

export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined) return '0.0%';
  return `${value.toFixed(1)}%`;
}

export function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function agentIdentity(agent: AgentSnapshot): string {
  const identity = agent.identity || agent.sessionPath;
  return identity || agent.id || `${agent.pid}`;
}

export function groupKeyForAgent(agent: AgentSnapshot): string {
  return agent.repo || agent.cwd || agent.cmd || agentIdentity(agent);
}

export function keyForAgent(agent: AgentSnapshot): string {
  return `${groupKeyForAgent(agent)}::${agentIdentity(agent)}`;
}

export function labelFor(agent: AgentSnapshot): string {
  const title = agent.title;
  const kind = typeof agent.kind === 'string' ? agent.kind : '';
  const isCodex =
    !kind.startsWith('opencode') &&
    !kind.startsWith('claude') &&
    kind !== 'app-server' &&
    !kind.endsWith('server');
  const looksLikeTempPath =
    typeof title === 'string' &&
    (/\/var\/folders\//i.test(title) ||
      /\/TemporaryItems\//i.test(title) ||
      /\/private\/var\//i.test(title));
  const looksLikeTurnMarker =
    typeof title === 'string' && /^<turn_/i.test(title.trim());
  const looksTooLong = typeof title === 'string' && title.trim().length > 80;
  const shouldIgnoreTitle =
    isCodex && !!title && (looksLikeTempPath || looksLikeTurnMarker || looksTooLong);
  if (title && !shouldIgnoreTitle) return title;
  if (agent.repo) return agent.repo;
  return `codex#${agent.pid}`;
}

export function formatDate(timestamp: number | undefined): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleTimeString();
}

export function formatDateFull(timestamp: number | undefined): string | null {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toLocaleString();
}
