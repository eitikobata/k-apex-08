import { computeBackoffMs } from './backoff.util';

describe('computeBackoffMs', () => {
  it('matches the brief reference cadence: 10s, 30s, 90s', () => {
    expect(computeBackoffMs(1)).toBe(10_000);
    expect(computeBackoffMs(2)).toBe(30_000);
    expect(computeBackoffMs(3)).toBe(90_000);
  });

  it('supports custom base and multiplier', () => {
    expect(computeBackoffMs(1, 1000, 2)).toBe(1000);
    expect(computeBackoffMs(2, 1000, 2)).toBe(2000);
    expect(computeBackoffMs(3, 1000, 2)).toBe(4000);
  });

  it('throws with the exact reason for attemptNumber below 1', () => {
    expect(() => computeBackoffMs(0)).toThrow('attemptNumber must be >= 1');
    expect(() => computeBackoffMs(-1)).toThrow('attemptNumber must be >= 1');
  });
});
