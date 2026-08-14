/**
 * K-SILENCE retry backoff. Pure function: attempt 1 -> baseMs, attempt 2 ->
 * baseMs*multiplier, etc. Brief's reference cadence is 10s / 30s / 90s,
 * i.e. base=10_000, multiplier=3.
 */
export function computeBackoffMs(attemptNumber: number, baseMs = 10_000, multiplier = 3): number {
  if (attemptNumber < 1) {
    throw new RangeError('attemptNumber must be >= 1');
  }
  return baseMs * Math.pow(multiplier, attemptNumber - 1);
}
