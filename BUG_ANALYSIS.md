# Bug Analysis & Fix: Agent State Animation Glitches

## Executive Summary

After thorough analysis of the consensus-cli codebase, I identified and fixed **multiple root causes** for the glitchy agent state animations affecting Codex, Claude Code, and OpenCode. The issues stemmed from inconsistent state management practices across the three agent types, problematic cache handling, and flawed state transition logic that broke the "hold" mechanism designed to prevent animation flickering.

## Root Causes Identified

### 1. **OpenCode State Logic Bug (Critical)** - FIXED

**File:** `src/opencodeState.ts`

**Original Problem:**
```typescript
else if (statusIsActive && state !== "active") {
  state = "idle";  // BUG: Incorrectly forces idle when status is "active"
}
```

When the status indicated "active/running/processing" but the derived state from `deriveStateWithHold` was "idle", this logic incorrectly forced the state to "idle", causing animation flicker.

**Fix:** Added proper evidence checking - only show as active when there's real evidence of work (inFlight, recent events, CPU activity, or active hold period).

### 2. **OpenCode `lastActiveAt` Reset Bug (Critical)** - FIXED

**File:** `src/opencodeState.ts`

**Original Problem:**
```typescript
if (state === "idle") {
  return { state, lastActiveAt: undefined };  // BUG: Clears hold state prematurely
}
```

When state transitioned to idle, the `lastActiveAt` timestamp was cleared, breaking the hold mechanism and causing rapid state oscillation.

**Fix:** Always preserve `lastActiveAt` regardless of final state, allowing the hold mechanism to work correctly across scan cycles.

### 3. **Claude State Cache Inconsistency (High)** - FIXED

**File:** `src/scan.ts`

**Original Problem:**
```typescript
activityCache.set(id, {
  lastActiveAt: state === "active" ? activity.lastActiveAt : undefined,  // BUG
  ...
});
```

The cache only preserved `lastActiveAt` when state was "active", clearing it on idle transitions and preventing the hold mechanism from working.

**Fix:** Always preserve `lastActiveAt` from the activity result in the cache.

### 4. **OpenCode Scan Double-Override (Medium)** - FIXED

**File:** `src/scan.ts`

**Original Problem:**
```typescript
if (!opencodeApiAvailable && !hasSignal) state = "idle";
if (!hasSignal && cpu <= cpuThreshold) {
  state = "idle";  // BUG: Overrides after hold was applied
}
```

Multiple state overrides after `deriveOpenCodeState` negated the hold mechanism.

**Fix:** Added check for `activity.lastActiveAt` to respect the hold period before forcing idle.

## Files Modified

| File | Changes |
|------|---------|
| `src/opencodeState.ts` | Fixed state logic, preserved lastActiveAt, added evidence checking |
| `src/claudeCli.ts` | Removed early return that bypassed hold mechanism |
| `src/codexState.ts` | Improved CPU handling with clearer documentation |
| `src/scan.ts` | Fixed cache handling and state override logic |

## Test Results

All 25 tests pass after the fixes:
- **Unit tests:** 20/20 passing
- **Integration tests:** 5/5 passing

## Impact on UI/UX

These fixes resolve:
1. **Rapid state flickering** - Agents no longer rapidly switch between active/idle
2. **Animation stuttering** - The pulsing animation runs smoothly
3. **Consistent visual feedback** - Users can reliably tell if an agent is working
4. **Proper hold state** - The grace period for keeping agents "active" now works correctly

## Technical Details

### The Hold Mechanism

The hold mechanism is designed to keep an agent showing as "active" for a grace period after activity stops. This prevents UI flickering when an agent briefly pauses between operations.

**How it works:**
1. When an agent is active, `lastActiveAt` is set to the current timestamp
2. When activity stops, the agent checks if `now - lastActiveAt <= holdMs`
3. If within the hold period, the agent stays "active" even without current activity
4. After the hold period expires, the agent transitions to "idle"

**What was broken:**
- `lastActiveAt` was being cleared prematurely
- State overrides were happening after the hold logic was applied
- Cache wasn't preserving the timestamp across scan cycles

### Key Insight

The core issue was that multiple places in the code were making independent decisions about state, without coordinating with the hold mechanism. The fix ensures that:

1. `deriveStateWithHold()` is the source of truth for the hold mechanism
2. `lastActiveAt` is always preserved in the result
3. Downstream code respects the hold period before overriding state
4. Cache preserves the timestamp for the next scan cycle
