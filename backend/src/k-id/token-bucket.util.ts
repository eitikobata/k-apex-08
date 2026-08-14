/**
 * Pure token-bucket algorithm. No I/O, no clock reads inside — `now` is
 * always passed in, which is what makes this trivially and precisely
 * unit-testable (and a good mutation-testing target: every boundary here
 * is meant to be exercised, e.g. `>=` vs `>` at the capacity check).
 */
export interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface TokenBucketConfig {
  /** Max tokens the bucket can hold. */
  capacity: number;
  /** Tokens regenerated per millisecond. */
  refillRatePerMs: number;
}

export interface ConsumeResult {
  allowed: boolean;
  state: TokenBucketState;
}

export function refill(state: TokenBucketState, config: TokenBucketConfig, nowMs: number): TokenBucketState {
  if (nowMs <= state.lastRefillMs) {
    // Clock didn't move forward (or went backward) — no refill, state unchanged.
    return state;
  }
  const elapsedMs = nowMs - state.lastRefillMs;
  const regenerated = elapsedMs * config.refillRatePerMs;
  const tokens = Math.min(config.capacity, state.tokens + regenerated);
  return { tokens, lastRefillMs: nowMs };
}

export function consume(
  state: TokenBucketState,
  config: TokenBucketConfig,
  nowMs: number,
  cost = 1,
): ConsumeResult {
  const refilled = refill(state, config, nowMs);
  if (refilled.tokens >= cost) {
    return {
      allowed: true,
      state: { tokens: refilled.tokens - cost, lastRefillMs: refilled.lastRefillMs },
    };
  }
  return { allowed: false, state: refilled };
}

/**
 * Exponential backoff lockout duration in ms, given the number of
 * consecutive failures. `baseMs * 2^(failCount - 1)`, capped at `maxMs`.
 * failCount <= 0 always yields 0 (no lockout).
 */
export function lockoutDurationMs(failCount: number, baseMs = 1000, maxMs = 15 * 60 * 1000): number {
  if (failCount <= 0) return 0;
  const raw = baseMs * Math.pow(2, failCount - 1);
  return Math.min(raw, maxMs);
}
