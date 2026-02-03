import { EventEmitter } from "node:events";
import WebSocket from "ws";

type Pending = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
};

export type PausedEvent = {
  callFrames: Array<{
    callFrameId: string;
    location: { scriptId: string; lineNumber: number; columnNumber: number };
  }>;
};

export class CdpClient extends EventEmitter {
  private socket: WebSocket;
  private idCounter = 1;
  private pending = new Map<number, Pending>();

  private constructor(socket: WebSocket) {
    super();
    this.socket = socket;
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(message.error.message || "CDP error"));
        } else {
          entry.resolve(message.result);
        }
        return;
      }
      if (message.method) {
        this.emit(message.method, message.params);
      }
    });
  }

  static async connect(inspectorPort: number): Promise<CdpClient> {
    const res = await fetch(`http://127.0.0.1:${inspectorPort}/json/list`);
    if (!res.ok) {
      throw new Error(`Inspector list failed: ${res.status}`);
    }
    const targets = (await res.json()) as Array<{ webSocketDebuggerUrl?: string }>;
    const wsUrl = targets.find((target) => target.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    if (!wsUrl) {
      throw new Error("No webSocketDebuggerUrl found for inspector");
    }
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (err) => reject(err));
    });
    return new CdpClient(socket);
  }

  async send(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = this.idCounter++;
    const payload = { id, method, params };
    const result = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify(payload));
    return result;
  }

  async enable(): Promise<void> {
    await this.send("Runtime.enable");
    await this.send("Debugger.enable");
  }

  async waitForPaused(timeoutMs: number): Promise<PausedEvent | null> {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off("Debugger.paused", onPaused);
        resolve(null);
      }, timeoutMs);
      const onPaused = (event: PausedEvent) => {
        clearTimeout(timer);
        this.off("Debugger.paused", onPaused);
        resolve(event);
      };
      this.on("Debugger.paused", onPaused);
    });
  }

  async resume(): Promise<void> {
    await this.send("Debugger.resume");
  }

  async evaluateOnCallFrame(callFrameId: string, expression: string): Promise<any> {
    return await this.send("Debugger.evaluateOnCallFrame", {
      callFrameId,
      expression,
      returnByValue: true,
    });
  }

  async getScriptSource(scriptId: string): Promise<string> {
    const result = await this.send("Debugger.getScriptSource", { scriptId });
    return result?.scriptSource ?? "";
  }

  async setBreakpoint(scriptId: string, lineNumber: number, columnNumber = 0): Promise<void> {
    await this.send("Debugger.setBreakpoint", {
      location: { scriptId, lineNumber, columnNumber },
    });
  }

  close(): void {
    this.socket.close();
  }
}

export function buildMarkerIndex(
  source: string
): Map<number, string> {
  const markers = new Map<number, string>();
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/TEST_HOOK_[A-Z0-9_]+/);
    if (match) {
      markers.set(i, match[0]);
    }
  }
  return markers;
}
