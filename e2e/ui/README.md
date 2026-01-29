# UI Test Spec

## Focus
- Activation latency: measure how quickly an active agent appears in the active lane after a snapshot.
- No flicker: ensure the active lane never shows the empty placeholder during rapid idle/active updates.

## Scenarios
1. **Activation latency budget**
   - Load `/?mock=1`.
   - Inject an empty snapshot to start from an idle UI.
   - Inject a snapshot with one active agent.
   - Assert the active lane receives the item within 3 animation frames and under 250ms.

2. **No flicker on rapid updates**
   - Start with one active agent in the lane.
   - Attach a MutationObserver to `#active-list`.
   - Send rapid idle → active snapshots in the same tick.
   - Assert no mutation shows `0` items or the "No active agents." placeholder.

## Helpers
- `tests/ui/helpers.ts`
  - `gotoMock`, `setMockSnapshot`, `pushSnapshots`
  - `measureActivationLatency`
  - `collectLaneMutations` + `hasLaneFlicker`
  - `waitForActiveListCount`, `waitForFrames`
