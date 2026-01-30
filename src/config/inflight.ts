const DEFAULT_INFLIGHT_TIMEOUT_MS = 15000;

const parseEnvMs = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const DISABLE_INFLIGHT_DECAY = -1;

const opencodeTimeoutEnv = parseEnvMs(process.env.CONSENSUS_OPENCODE_INFLIGHT_TIMEOUT_MS);
const opencodeIdleEnv = parseEnvMs(process.env.CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS);
const claudeTimeoutEnv = parseEnvMs(process.env.CONSENSUS_CLAUDE_INFLIGHT_TIMEOUT_MS);

export const INFLIGHT_CONFIG = {
  opencode: {
    timeoutMs: opencodeTimeoutEnv ?? DEFAULT_INFLIGHT_TIMEOUT_MS,
    idleMs: opencodeIdleEnv ?? opencodeTimeoutEnv ?? DEFAULT_INFLIGHT_TIMEOUT_MS,
  },
  claude: {
    timeoutMs: claudeTimeoutEnv ?? DEFAULT_INFLIGHT_TIMEOUT_MS,
  },
} as const;
