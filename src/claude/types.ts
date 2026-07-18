import { Schema } from "effect";
import type { EventSummary, WorkSummary } from "../types.js";

export const ClaudeEventSchema = Schema.Struct({
  type: Schema.String,
  sessionId: Schema.String,
  cwd: Schema.optional(Schema.String),
  transcriptPath: Schema.optional(Schema.String),
  notificationType: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
  agentType: Schema.optional(Schema.String),
  final: Schema.optional(Schema.Boolean),
  timestamp: Schema.Number,
});

export type ClaudeEvent = Schema.Schema.Type<typeof ClaudeEventSchema>;

export interface ClaudeSessionState {
  sessionId: string;
  inFlight: boolean;
  lastActivityAt?: number;
  lastEventAt?: number;
  lastSeenAt: number;
  cwd?: string;
  cwdKey?: string;
  transcriptPath?: string;
  lastEvent?: string;
  events: EventSummary[];
  summary: WorkSummary;
  hasError?: boolean;
}
