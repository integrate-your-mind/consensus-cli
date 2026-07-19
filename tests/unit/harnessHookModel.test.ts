import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  harnessHookEventKey,
  harnessHookEventSummary,
  normalizeHarnessHookPayload,
} from "../../src/harnessHookModel.js";

describe("shared harness hook model", () => {
  it("normalizes Claude-style hooks without retaining prompt or tool input", () => {
    const event = normalizeHarnessHookPayload(
      "kimi",
      {
        hook_event_name: "PreToolUse",
        session_id: "session-secret",
        cwd: "/Users/alice/private/project",
        timestamp: "2026-07-19T01:00:00.000Z",
        tool_name: "Bash",
        tool_input: { command: "rm -rf private" },
        prompt: "private prompt",
      },
      1
    );

    assert.ok(event);
    assert.equal(event?.harnessId, "kimi");
    assert.equal(event?.type, "PreToolUse");
    assert.equal(event?.toolName, "Bash");
    assert.match(event?.sessionKey ?? "", /^[a-f0-9]{24}$/);
    assert.match(event?.cwdKey ?? "", /^[a-f0-9]{24}$/);
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes("session-secret"), false);
    assert.equal(serialized.includes("/Users/alice"), false);
    assert.equal(serialized.includes("rm -rf"), false);
    assert.equal(serialized.includes("private prompt"), false);
  });

  it("maps Hermes loop hooks to canonical turn and tool events", () => {
    const payloads = [
      ["pre_llm_call", "UserPromptSubmit", "prompt"],
      ["pre_tool_call", "PreToolUse", "tool: terminal"],
      ["post_tool_call", "PostToolUse", "tool: terminal"],
      ["pre_verify", "PreVerify", "tool: verify"],
      ["post_llm_call", "Stop", "event: Stop"],
      ["subagent_stop", "SubagentStop", "tool: subagent explore"],
    ] as const;

    for (const [rawType, canonicalType, summary] of payloads) {
      const normalized = normalizeHarnessHookPayload("hermes", {
        hook_event_name: rawType,
        session_id: "hermes-session",
        timestamp: 1_000,
        tool_name: "terminal",
        extra: { child_role: "explore", turn_id: "turn-1" },
      });
      assert.equal(normalized?.type, canonicalType, rawType);
      assert.equal(harnessHookEventSummary(normalized!)?.summary, summary, rawType);
    }
  });

  it("normalizes Kimi interrupt and failure events into turn boundaries", () => {
    const interrupted = normalizeHarnessHookPayload("kimi", {
      hook_event_name: "Interrupt",
      session_id: "session",
      timestamp: 1,
    });
    const failed = normalizeHarnessHookPayload("kimi", {
      hook_event_name: "StopFailure",
      session_id: "session",
      timestamp: 2,
    });

    assert.equal(harnessHookEventSummary(interrupted!)?.type, "turn.interrupted");
    assert.equal(harnessHookEventSummary(failed!)?.type, "turn.failed");
    assert.equal(harnessHookEventSummary(failed!)?.isError, true);
  });

  it("drops non-final stream fragments and activity-only events from graph history", () => {
    const partial = normalizeHarnessHookPayload("claude", {
      hook_event_name: "MessageDisplay",
      session_id: "session",
      timestamp: 1,
      final: false,
    });
    const expansion = normalizeHarnessHookPayload("claude", {
      hook_event_name: "UserPromptExpansion",
      session_id: "session",
      timestamp: 2,
    });
    const notification = normalizeHarnessHookPayload("factory", {
      hook_event_name: "Notification",
      session_id: "session",
      timestamp: 3,
      notification_type: "idle_prompt",
    });

    assert.equal(harnessHookEventSummary(partial!), undefined);
    assert.equal(harnessHookEventSummary(expansion!), undefined);
    assert.equal(harnessHookEventSummary(notification!), undefined);
  });

  it("uses opaque turn correlation keys consistently", () => {
    const first = normalizeHarnessHookPayload("qwen", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session",
      turn_id: "turn-secret",
      timestamp: 1,
    });
    const second = normalizeHarnessHookPayload("qwen", {
      hook_event_name: "PreToolUse",
      session_id: "session",
      turn_id: "turn-secret",
      timestamp: 2,
      tool_name: "Bash",
    });

    assert.equal(first?.turnKey, second?.turnKey);
    assert.match(first?.turnKey ?? "", /^[a-f0-9]{24}$/);
    assert.equal(JSON.stringify(first).includes("turn-secret"), false);
    assert.equal(harnessHookEventSummary(first!)?.turnId, first?.turnKey);
  });

  it("parses seconds, milliseconds, ISO timestamps, and received-time fallback", () => {
    const seconds = normalizeHarnessHookPayload("factory", {
      hook_event_name: "SessionStart",
      session_id: "s1",
      timestamp: 1_700_000_000,
    });
    const milliseconds = normalizeHarnessHookPayload("factory", {
      hook_event_name: "SessionStart",
      session_id: "s2",
      timestamp: 1_700_000_000_000,
    });
    const iso = normalizeHarnessHookPayload("factory", {
      hook_event_name: "SessionStart",
      session_id: "s3",
      timestamp: "2026-07-19T00:00:00.000Z",
    });
    const fallback = normalizeHarnessHookPayload(
      "factory",
      { hook_event_name: "SessionStart", session_id: "s4" },
      1234
    );

    assert.equal(seconds?.timestamp, 1_700_000_000_000);
    assert.equal(milliseconds?.timestamp, 1_700_000_000_000);
    assert.equal(iso?.timestamp, Date.parse("2026-07-19T00:00:00.000Z"));
    assert.equal(fallback?.timestamp, 1234);
  });

  it("rejects unknown events and malformed payloads", () => {
    assert.equal(normalizeHarnessHookPayload("kimi", null), undefined);
    assert.equal(
      normalizeHarnessHookPayload("kimi", {
        hook_event_name: "UnknownFutureEvent",
        session_id: "session",
      }),
      undefined
    );
    assert.equal(
      normalizeHarnessHookPayload("kimi", {
        hook_event_name: "PreToolUse",
      }),
      undefined
    );
  });

  it("creates stable deduplication keys from retained metadata only", () => {
    const event = normalizeHarnessHookPayload("factory", {
      hook_event_name: "PostToolUse",
      session_id: "session",
      timestamp: 1,
      tool_name: "Execute",
      tool_output: "secret",
    });
    const key = harnessHookEventKey(event!);

    assert.equal(key.includes("secret"), false);
    assert.equal(key, harnessHookEventKey(event!));
  });
});
