import { Schema } from "effect";

/**
 * Codex event types from notify hook
 */
export const CodexEventType = Schema.Literal(
  "thread.started",
  "turn.started",
  "agent-turn-complete",
  "item.started",
  "item.completed"
);

/**
 * Schema for events received from Codex notify hook
 */
export const CodexEventSchema = Schema.Struct({
  type: CodexEventType,
  threadId: Schema.String,
  turnId: Schema.Union(Schema.String, Schema.Number).pipe(Schema.optional),
  timestamp: Schema.Number
});

export type CodexEvent = Schema.Schema.Type<typeof CodexEventSchema>;

/**
 * Thread state tracked in event store
 */
export interface ThreadState {
  readonly inFlight: boolean;
  readonly lastActivityAt: number;
  readonly activeItems: ReadonlySet<string>;
}

/**
 * Result from setup operation
 */
export interface HookSetupResult {
  readonly _tag: "HookSetupResult";
  readonly configured: boolean;
  readonly message: string;
  readonly configPath: string;
}

/**
 * Errors that can occur during setup
 */
export class CodexSetupError {
  readonly _tag = "CodexSetupError" as const;
  constructor(
    readonly reason: "CONFIG_WRITE_FAILED" | "ALREADY_CONFIGURED" | "PERMISSION_DENIED",
    readonly message: string
  ) {}
}

/**
 * Consensus configuration persisted after setup
 */
export const ConsensusConfigSchema = Schema.Struct({
  version: Schema.Literal("1"),
  hookConfigured: Schema.Boolean,
  otelEnabled: Schema.Boolean,
  setupCompletedAt: Schema.Number
});

export type ConsensusConfig = Schema.Schema.Type<typeof ConsensusConfigSchema>;
