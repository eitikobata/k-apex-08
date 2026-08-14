/**
 * Classic 3-state circuit breaker (CLOSED / OPEN / HALF_OPEN), pure —
 * no timers, no network calls. Used exclusively to gate the optional AI
 * enrichment call (K-BLACKBOX summaries/embeddings); the deterministic
 * K-DIRECTIVE decision path never goes through this at all.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  openedAtMs: number | null;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
}

export const INITIAL_CIRCUIT_STATE: CircuitBreakerState = {
  state: 'CLOSED',
  consecutiveFailures: 0,
  openedAtMs: null,
};

export interface AllowResult {
  allowed: boolean;
  state: CircuitBreakerState;
}

/**
 * Call before attempting the guarded operation. If OPEN and the cooldown
 * has elapsed, transitions to HALF_OPEN and allows exactly this one trial
 * call through (the caller is expected to serialize calls — this module
 * doesn't track in-flight trial calls, a deliberate simplicity trade-off
 * for this project's single-instance scale).
 */
export function checkAllowRequest(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  nowMs: number,
): AllowResult {
  if (state.state === 'OPEN') {
    const elapsed = state.openedAtMs === null ? Infinity : nowMs - state.openedAtMs;
    if (elapsed >= config.cooldownMs) {
      return { allowed: true, state: { ...state, state: 'HALF_OPEN' } };
    }
    return { allowed: false, state };
  }
  return { allowed: true, state };
}

/** Call after the guarded operation completes (or the request was denied and skipped). */
export function recordOutcome(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  success: boolean,
  nowMs: number,
): CircuitBreakerState {
  if (success) {
    return { state: 'CLOSED', consecutiveFailures: 0, openedAtMs: null };
  }

  if (state.state === 'HALF_OPEN') {
    return { state: 'OPEN', consecutiveFailures: config.failureThreshold, openedAtMs: nowMs };
  }

  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= config.failureThreshold) {
    return { state: 'OPEN', consecutiveFailures, openedAtMs: nowMs };
  }
  return { state: 'CLOSED', consecutiveFailures, openedAtMs: null };
}
