import { Schema } from "effect";

export const ClaudeEventSchema = Schema.Struct({
  type: Schema.String,
  sessionId: Schema.String,
  cwd: Schema.optional(Schema.String),
  transcriptPath: Schema.optional(Schema.String),
  notificationType: Schema.optional(Schema.String),
  timestamp: Schema.Number,
});

export type ClaudeEvent = Schema.Schema.Type<typeof ClaudeEventSchema>;

export interface ClaudeSessionState {
  sessionId: string;
  inFlight: boolean;
  lastActivityAt?: number;
  lastSeenAt: number;
  cwd?: string;
  transcriptPath?: string;
  lastEvent?: string;
}
