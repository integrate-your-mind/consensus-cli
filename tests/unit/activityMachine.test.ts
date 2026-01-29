/**
 * Tests for the Effect-based activity state machine
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { deriveState, deriveCodexState, deriveOpenCodeState, deriveClaudeState } from "../../src/activity/machine.js"
import type { ActivityContext } from "../../src/activity/types.js"

// Base context for tests
const baseContext: ActivityContext = {
  cpu: 0,
  hasError: false,
  inFlight: false,
  now: 1000000,
  cpuThreshold: 1,
  eventWindowMs: 30000,
  holdMs: 0,
  spikeMultiplier: 10,
  spikeMinimum: 25,
  cpuActiveMs: 0,
  sustainMs: 500,
  inFlightGraceMs: 0,
  strictInFlight: false,
}

describe("activity/machine", () => {
  describe("deriveState", () => {
    it("should return error when hasError is true", async () => {
      const ctx = { ...baseContext, hasError: true }
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "error")
      assert.strictEqual(result.reason, "error")
    })

    it("should return active when inFlight signal is present", async () => {
      const ctx = { 
        ...baseContext, 
        inFlight: true,
        lastInFlightSignalAt: baseContext.now - 1000,
        inFlightIdleMs: 30000,
      }
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "active")
      assert.strictEqual(result.reason, "in_flight")
    })

    it("should return active on CPU spike", async () => {
      const ctx = { ...baseContext, cpu: 30 } // Above spike threshold (25)
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "active")
      assert.strictEqual(result.reason, "cpu_spike")
    })

    it("should return active on recent activity", async () => {
      const ctx = { 
        ...baseContext, 
        lastActivityAt: baseContext.now - 5000, // Within 30s window
      }
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "active")
      assert.strictEqual(result.reason, "recent_event")
    })

    it("should return active on sustained CPU", async () => {
      const ctx = { 
        ...baseContext, 
        cpu: 5, // Above threshold (1)
        cpuActiveMs: 600, // Above sustain (500)
      }
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "active")
      assert.strictEqual(result.reason, "sustained_cpu")
    })

    it("should return idle when no signals present", async () => {
      const ctx = { ...baseContext }
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "idle")
      assert.strictEqual(result.reason, "no_signal")
    })

    it("should respect hold period", async () => {
      const ctx = { 
        ...baseContext, 
        holdMs: 10000,
        previousActiveAt: baseContext.now - 5000, // Within hold period
      }
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "active")
      assert.strictEqual(result.reason, "hold_active")
    })

    it("should return idle when hold expires", async () => {
      const ctx = { 
        ...baseContext, 
        holdMs: 10000,
        previousActiveAt: baseContext.now - 15000, // Beyond hold period
      }
      const result = await Effect.runPromise(deriveState(ctx))
      
      assert.strictEqual(result.state, "idle")
      assert.strictEqual(result.reason, "no_signal")
    })
  })

  describe("deriveCodexState", () => {
    it("should use codex defaults", async () => {
      const now = 1000000
      const result = await Effect.runPromise(
        deriveCodexState({
          cpu: 30,
          hasError: false,
          inFlight: false,
          now,
          cpuThreshold: 1,
          eventWindowMs: 30000,
          holdMs: 0,
          cpuActiveMs: 0,
        })
      )
      
      assert.strictEqual(result.state, "active")
      assert.strictEqual(result.reason, "cpu_spike")
    })
  })

  describe("deriveOpenCodeState", () => {
    it("should return idle for server processes", async () => {
      const result = await Effect.runPromise(
        deriveOpenCodeState({
          cpu: 30,
          hasError: false,
          inFlight: false,
          now: 1000000,
          cpuThreshold: 1,
          eventWindowMs: 30000,
          holdMs: 0,
          cpuActiveMs: 0,
          isServer: true,
        })
      )
      
      assert.strictEqual(result.state, "idle")
      assert.strictEqual(result.reason, "server_idle")
    })

    it("should return error for server with error", async () => {
      const result = await Effect.runPromise(
        deriveOpenCodeState({
          cpu: 0,
          hasError: true,
          inFlight: false,
          now: 1000000,
          cpuThreshold: 1,
          eventWindowMs: 30000,
          holdMs: 0,
          cpuActiveMs: 0,
          isServer: true,
        })
      )
      
      assert.strictEqual(result.state, "error")
      assert.strictEqual(result.reason, "error")
    })

    it("should return idle for idle status", async () => {
      const result = await Effect.runPromise(
        deriveOpenCodeState({
          cpu: 0,
          hasError: false,
          inFlight: false,
          now: 1000000,
          cpuThreshold: 1,
          eventWindowMs: 30000,
          holdMs: 0,
          cpuActiveMs: 0,
          status: "idle",
        })
      )
      
      assert.strictEqual(result.state, "idle")
      assert.strictEqual(result.reason, "status_idle")
    })
  })

  describe("deriveClaudeState", () => {
    it("should return active during start grace period", async () => {
      const now = 1000000
      const result = await Effect.runPromise(
        deriveClaudeState({
          cpu: 0,
          hasError: false,
          inFlight: false,
          now,
          lastActivityAt: now - 500, // Within 1200ms grace
          cpuThreshold: 1,
          eventWindowMs: 30000,
          cpuActiveMs: 0,
          startGraceMs: 1200,
        })
      )
      
      assert.strictEqual(result.state, "active")
      assert.strictEqual(result.reason, "start_grace")
    })
  })
})
