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
