export interface ActivitySignalState {
  lastInFlightSignalAt?: number;
  lastActivityAt?: number;
  lastEventAt?: number;
  lastSeenAt?: number;
}

export const getLastSignalAt = (state: ActivitySignalState): number | undefined =>
  state.lastInFlightSignalAt ?? state.lastActivityAt ?? state.lastEventAt ?? state.lastSeenAt;
