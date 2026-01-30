import type { AgentSnapshot, AgentState, CliPalette, CliType, TileColors } from '../types';

export const cliPalettes: Record<CliType, CliPalette> = {
  codex: {
    agent: {
      active: { top: '#3d8f7f', left: '#2d6d61', right: '#275b52', stroke: '#54cdb1' },
      idle: { top: '#384a57', left: '#2b3943', right: '#25323b', stroke: '#4f6b7a' },
      error: { top: '#82443c', left: '#6d3530', right: '#5a2c28', stroke: '#d1584b' },
    },
    server: {
      active: { top: '#4e665e', left: '#3d524b', right: '#32453f', stroke: '#79b8a8' },
      idle: { top: '#353f48', left: '#2a323a', right: '#232a30', stroke: '#526577' },
      error: { top: '#82443c', left: '#6d3530', right: '#5a2c28', stroke: '#d1584b' },
    },
    accent: '#57f2c6',
    accentStrong: 'rgba(87, 242, 198, 0.6)',
    accentSoft: 'rgba(87, 242, 198, 0.35)',
    glow: '87, 242, 198',
  },
  opencode: {
    agent: {
      active: { top: '#8a6a2f', left: '#6f5626', right: '#5b4621', stroke: '#f1bd4f' },
      idle: { top: '#3c3a37', left: '#2f2d2a', right: '#262322', stroke: '#7f6f56' },
      error: { top: '#86443b', left: '#70352f', right: '#5c2c28', stroke: '#e0705c' },
    },
    server: {
      active: { top: '#7d6a2b', left: '#665725', right: '#54481f', stroke: '#f5c453' },
      idle: { top: '#353b42', left: '#272c33', right: '#1f242a', stroke: '#6b7380' },
      error: { top: '#86443b', left: '#70352f', right: '#5c2c28', stroke: '#e0705c' },
    },
    accent: '#f5c453',
    accentStrong: 'rgba(245, 196, 83, 0.6)',
    accentSoft: 'rgba(245, 196, 83, 0.35)',
    glow: '245, 196, 83',
  },
  claude: {
    agent: {
      active: { top: '#3f6fa3', left: '#2f5580', right: '#25476a', stroke: '#7fb7ff' },
      idle: { top: '#374252', left: '#2a323f', right: '#232a35', stroke: '#5c6f85' },
      error: { top: '#7f4140', left: '#683334', right: '#552a2b', stroke: '#e06b6a' },
    },
    server: {
      active: { top: '#4b5f74', left: '#3a4a5c', right: '#2f3d4d', stroke: '#91b4d6' },
      idle: { top: '#323b47', left: '#262d36', right: '#20262d', stroke: '#556577' },
      error: { top: '#7f4140', left: '#683334', right: '#552a2b', stroke: '#e06b6a' },
    },
    accent: '#7fb7ff',
    accentStrong: 'rgba(127, 183, 255, 0.6)',
    accentSoft: 'rgba(127, 183, 255, 0.35)',
    glow: '127, 183, 255',
  },
};

export const stateOpacity: Record<AgentState, number> = {
  active: 1,
  idle: 0.35,
  error: 0.9,
};

export function cliForAgent(agent: AgentSnapshot): CliType {
  const kind = agent.kind || '';
  if (kind.startsWith('opencode')) return 'opencode';
  if (kind.startsWith('claude')) return 'claude';
  return 'codex';
}

export function isServerKind(kind: string): boolean {
  const normalized = typeof kind === 'string' ? kind : '';
  return normalized.endsWith('server') || normalized === 'app-server';
}

export function paletteFor(agent: AgentSnapshot): TileColors {
  const cli = cliForAgent(agent);
  const palette = cliPalettes[cli] ?? cliPalettes.codex;
  const scope = isServerKind(agent.kind) ? palette.server : palette.agent;
  return scope[agent.state] ?? scope.idle;
}

export function accentFor(agent: AgentSnapshot): string {
  const cli = cliForAgent(agent);
  return (cliPalettes[cli] ?? cliPalettes.codex).accent;
}

export function accentStrongFor(agent: AgentSnapshot): string {
  const cli = cliForAgent(agent);
  return (cliPalettes[cli] ?? cliPalettes.codex).accentStrong;
}

export function accentSoftFor(agent: AgentSnapshot): string {
  const cli = cliForAgent(agent);
  return (cliPalettes[cli] ?? cliPalettes.codex).accentSoft;
}

export function accentGlow(agent: AgentSnapshot, alpha: number): string {
  const cli = cliForAgent(agent);
  const tint = (cliPalettes[cli] ?? cliPalettes.codex).glow;
  return `rgba(${tint}, ${alpha})`;
}

export function opacityFor(state: AgentState): number {
  return stateOpacity[state] ?? 1;
}
