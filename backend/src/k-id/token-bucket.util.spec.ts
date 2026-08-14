import { consume, lockoutDurationMs, refill, TokenBucketConfig } from './token-bucket.util';

const CONFIG: TokenBucketConfig = { capacity: 10, refillRatePerMs: 1 / 1000 }; // 1 token/sec

describe('token-bucket.util', () => {
  describe('refill', () => {
    it('does not exceed capacity even with a huge elapsed time', () => {
      const state = refill({ tokens: 5, lastRefillMs: 0 }, CONFIG, 1_000_000);
      expect(state.tokens).toBe(10);
    });

    it('adds tokens proportional to elapsed time', () => {
      const state = refill({ tokens: 0, lastRefillMs: 0 }, CONFIG, 3000);
      expect(state.tokens).toBe(3);
    });

    it('is a no-op when now equals lastRefillMs', () => {
      const state = refill({ tokens: 4, lastRefillMs: 500 }, CONFIG, 500);
      expect(state).toEqual({ tokens: 4, lastRefillMs: 500 });
    });

    it('is a no-op when now is before lastRefillMs (clock skew guard)', () => {
      const state = refill({ tokens: 4, lastRefillMs: 500 }, CONFIG, 100);
      expect(state).toEqual({ tokens: 4, lastRefillMs: 500 });
    });
  });

  describe('consume', () => {
    it('allows consumption exactly at the available token boundary', () => {
      const result = consume({ tokens: 1, lastRefillMs: 0 }, CONFIG, 0, 1);
      expect(result.allowed).toBe(true);
      expect(result.state.tokens).toBe(0);
    });

    it('denies consumption just below the required cost', () => {
      const result = consume({ tokens: 0.9, lastRefillMs: 0 }, CONFIG, 0, 1);
      expect(result.allowed).toBe(false);
      // state is still refilled/returned even on denial, just not decremented
      expect(result.state.tokens).toBe(0.9);
    });

    it('refills before checking, so a stale-empty bucket can allow after enough time', () => {
      const result = consume({ tokens: 0, lastRefillMs: 0 }, CONFIG, 5000, 1);
      expect(result.allowed).toBe(true);
      expect(result.state.tokens).toBe(4); // 5 refilled - 1 consumed
    });

    it('supports cost > 1', () => {
      const result = consume({ tokens: 10, lastRefillMs: 0 }, CONFIG, 0, 5);
      expect(result.allowed).toBe(true);
      expect(result.state.tokens).toBe(5);
    });
  });

  describe('lockoutDurationMs', () => {
    it('returns 0 for zero or negative fail counts', () => {
      expect(lockoutDurationMs(0)).toBe(0);
      expect(lockoutDurationMs(-3)).toBe(0);
    });

    it('doubles with each consecutive failure', () => {
      expect(lockoutDurationMs(1, 1000)).toBe(1000);
      expect(lockoutDurationMs(2, 1000)).toBe(2000);
      expect(lockoutDurationMs(3, 1000)).toBe(4000);
      expect(lockoutDurationMs(4, 1000)).toBe(8000);
    });

    it('caps at maxMs', () => {
      expect(lockoutDurationMs(30, 1000, 15 * 60 * 1000)).toBe(15 * 60 * 1000);
    });
  });
});
