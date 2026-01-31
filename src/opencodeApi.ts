export interface OpenCodeSession {
  id: string;
  title?: string;
  name?: string;
  created?: string;
  createdAt?: string;
  lastActivity?: string;
  lastActivityAt?: string;
  updatedAt?: string;
  updated?: string;
  time?: {
    created?: number;
    updated?: number;
  };
  pid?: number;
  status?: string;
  model?: string;
  cwd?: string;
  directory?: string;
}

export interface OpenCodeSessionResult {
  ok: boolean;
  sessions: OpenCodeSession[];
  status?: number;
  error?: string;
  reachable?: boolean;
}

export interface OpenCodeApiOptions {
  timeoutMs?: number;
  silent?: boolean;
}

function shouldWarn(options?: OpenCodeApiOptions): boolean {
  return options?.silent ? false : true;
}

const DEFAULT_OPENCODE_INFLIGHT_TIMEOUT_MS = 2500;

export async function getOpenCodeSessions(
  host: string = "localhost",
  port: number = 4096,
  options?: OpenCodeApiOptions
): Promise<OpenCodeSessionResult> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 5000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const warn = shouldWarn(options);

  try {
    const response = await fetch(`http://${host}:${port}/session`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "consensus-scanner",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (warn) {
        console.warn(`OpenCode API error: ${response.status} ${response.statusText}`);
      }
      return { ok: false, sessions: [], status: response.status, reachable: true };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      if (warn) {
        console.warn(`OpenCode API non-JSON response (${contentType || "unknown"})`);
      }
      return { ok: false, sessions: [], status: response.status, reachable: true, error: "non_json" };
    }

    const payload = await response.json();
    if (Array.isArray(payload)) return { ok: true, sessions: payload, reachable: true };
    if (payload && typeof payload === "object" && Array.isArray(payload.sessions)) {
      return { ok: true, sessions: payload.sessions, reachable: true };
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
      return { ok: true, sessions: payload.data, reachable: true };
    }
    return { ok: true, sessions: [], reachable: true };
  } catch (error) {
    clearTimeout(timeoutId);
    if (warn) {
      console.warn("Failed to fetch OpenCode sessions:", error);
    }
    const errorCode =
      typeof (error as any)?.cause?.code === "string"
        ? (error as any).cause.code
        : typeof (error as any)?.code === "string"
          ? (error as any).code
          : undefined;
    return { ok: false, sessions: [], error: errorCode, reachable: false };
  }
}

export async function getOpenCodeSession(
  sessionId: string,
  host: string = "localhost",
  port: number = 4096,
  options?: OpenCodeApiOptions
): Promise<OpenCodeSession | null> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 5000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const warn = shouldWarn(options);

  try {
    const response = await fetch(`http://${host}:${port}/session/${sessionId}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "consensus-scanner",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (warn) {
        console.warn(
          `OpenCode API error for session ${sessionId}: ${response.status} ${response.statusText}`
        );
      }
      return null;
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (warn) {
      console.warn(`Failed to fetch OpenCode session ${sessionId}:`, error);
    }
    return null;
  }
}

export interface OpenCodeMessagePart {
  id?: string;
  type?: string;
  tool?: string;
  state?: {
    status?: string; // "pending" | "running" | "completed" | "error"
  };
  time?: {
    start?: number;
    end?: number;
  };
}

export interface OpenCodeMessage {
  info?: {
    id?: string;
    sessionID?: string;
    role?: string;
    time?: {
      created?: number;
      completed?: number;
    };
    error?: {
      name?: string;
      data?: { message?: string };
    };
    modelID?: string;
    providerID?: string;
  };
  parts?: OpenCodeMessagePart[];
}

export interface OpenCodeMessageActivityResult {
  ok: boolean;
  inFlight: boolean;
  lastActivityAt?: number;
  error?: string;
}

/**
 * Check if a session has an actively generating message by looking at the latest
 * assistant message and checking if time.completed is missing.
 * This provides a reliable signal for TUI activity since SSE events are not available.
 */
export async function getOpenCodeSessionActivity(
  sessionId: string,
  host: string = "localhost",
  port: number = 4096,
  options?: OpenCodeApiOptions
): Promise<OpenCodeMessageActivityResult> {
  const staleMsRaw = process.env.CONSENSUS_OPENCODE_INFLIGHT_STALE_MS;
  const staleMs =
    staleMsRaw !== undefined && staleMsRaw !== ""
      ? Number(staleMsRaw)
      : 0;
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 3000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const warn = shouldWarn(options);

  try {
    const response = await fetch(`http://${host}:${port}/session/${sessionId}/message`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "consensus-scanner",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { ok: false, inFlight: false, error: `status_${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      return { ok: false, inFlight: false, error: "non_json" };
    }

    const messages: OpenCodeMessage[] = await response.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return { ok: true, inFlight: false };
    }

    // Find the latest assistant message
    let latestAssistant: OpenCodeMessage | undefined;
    let latestActivityAt: number | undefined;
    let latestMessageRole: string | undefined;
    let latestMessageAt: number | undefined;
    
    for (const msg of messages) {
      const created = msg?.info?.time?.created;
      const completed = msg?.info?.time?.completed;
      
      // Track latest activity timestamp
      if (typeof created === "number") {
        latestActivityAt = latestActivityAt ? Math.max(latestActivityAt, created) : created;
      }
      if (typeof completed === "number") {
        latestActivityAt = latestActivityAt ? Math.max(latestActivityAt, completed) : completed;
      }

      const messageActivityAt =
        typeof completed === "number" ? completed : typeof created === "number" ? created : undefined;
      if (
        typeof messageActivityAt === "number" &&
        (typeof latestMessageAt !== "number" || messageActivityAt > latestMessageAt)
      ) {
        latestMessageAt = messageActivityAt;
        latestMessageRole = msg?.info?.role;
      }
      
      // Track latest assistant message
      if (msg?.info?.role === "assistant") {
        if (!latestAssistant || (created && (!latestAssistant.info?.time?.created || created > latestAssistant.info.time.created))) {
          latestAssistant = msg;
        }
      }
    }

    if (!latestAssistant) {
      let inFlight = false;
      if (latestMessageRole === "user" && typeof latestMessageAt === "number") {
        const windowMsRaw = process.env.CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS;
        const windowMs =
          windowMsRaw !== undefined && windowMsRaw !== ""
            ? Number(windowMsRaw)
            : DEFAULT_OPENCODE_INFLIGHT_TIMEOUT_MS;
        if (Number.isFinite(windowMs) && windowMs > 0 && Date.now() - latestMessageAt <= windowMs) {
          inFlight = true;
        }
      }
      return { ok: true, inFlight, lastActivityAt: latestActivityAt };
    }

    // Check if the latest assistant message is incomplete (no completed timestamp)
    const hasCompleted = typeof latestAssistant.info?.time?.completed === "number";
    
    // Also check for pending/running tool calls in message parts
    let hasPendingTool = false;
    let hasIncompletePart = false;
    let latestPartStart: number | undefined;
    
    if (Array.isArray(latestAssistant.parts)) {
      for (const part of latestAssistant.parts) {
        // Check for pending or running tool
        if (part?.type === "tool") {
          const status = part?.state?.status;
          if (status === "pending" || status === "running") {
            hasPendingTool = true;
          }
        }
        // Check for parts with start but no end time (still in progress)
        if (typeof part?.time?.start === "number") {
          if (typeof part?.time?.end !== "number") {
            hasIncompletePart = true;
          }
          latestPartStart = latestPartStart
            ? Math.max(latestPartStart, part.time.start)
            : part.time.start;
        }
      }
    }
    
    // Session is in flight if:
    // 1. Assistant message has no completed timestamp, OR
    // 2. There's a pending/running tool call
    // Incomplete parts only matter when the message is not completed.
    let inFlight = hasPendingTool || !hasCompleted;
    const assistantCreatedAt = latestAssistant?.info?.time?.created;
    const inFlightSignalAt =
      !hasCompleted && typeof assistantCreatedAt === "number"
        ? assistantCreatedAt
        : hasPendingTool && typeof latestPartStart === "number"
          ? latestPartStart
          : undefined;

    if (!inFlight && latestMessageRole === "user" && typeof latestMessageAt === "number") {
      const windowMsRaw = process.env.CONSENSUS_OPENCODE_INFLIGHT_IDLE_MS;
      const windowMs =
        windowMsRaw !== undefined && windowMsRaw !== ""
          ? Number(windowMsRaw)
          : DEFAULT_OPENCODE_INFLIGHT_TIMEOUT_MS;
      if (Number.isFinite(windowMs) && windowMs > 0 && Date.now() - latestMessageAt <= windowMs) {
        inFlight = true;
      }
    }
    
    if (inFlight && Number.isFinite(staleMs) && staleMs > 0) {
      if (typeof inFlightSignalAt === "number") {
        if (Date.now() - inFlightSignalAt > staleMs) {
          inFlight = false;
        }
      } else if (typeof latestActivityAt !== "number") {
        inFlight = false;
      }
    }

    return {
      ok: true,
      inFlight,
      lastActivityAt: latestActivityAt,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (warn) {
      console.warn(`Failed to fetch OpenCode session activity ${sessionId}:`, error);
    }
    return { ok: false, inFlight: false, error: "fetch_error" };
  }
}
