import { detectMultiStageAttack, evaluateSlidingWindow } from './sliding-window-correlator.util';

describe('evaluateSlidingWindow', () => {
  const config = { windowMs: 10_000, threshold: 3 };

  it('triggers when count meets the threshold exactly', () => {
    const result = evaluateSlidingWindow([1000, 2000, 3000], 5000, config);
    expect(result.triggered).toBe(true);
    expect(result.countedTimestampsMs).toEqual([1000, 2000, 3000]);
  });

  it('does not trigger one event below threshold', () => {
    const result = evaluateSlidingWindow([1000, 2000], 5000, config);
    expect(result.triggered).toBe(false);
  });

  it('excludes events outside the window on the old side', () => {
    // now=20000, window=10000 => window start = 10000. ts=9999 is just outside.
    const result = evaluateSlidingWindow([9999, 10000, 15000, 20000], 20000, config);
    expect(result.countedTimestampsMs).toEqual([10000, 15000, 20000]);
    expect(result.triggered).toBe(true);
  });

  it('excludes events from the future relative to now', () => {
    const result = evaluateSlidingWindow([1000, 2000, 99_999], 5000, config);
    expect(result.countedTimestampsMs).toEqual([1000, 2000]);
    expect(result.triggered).toBe(false);
  });

  it('deduplicates identical timestamps', () => {
    const result = evaluateSlidingWindow([1000, 1000, 1000], 5000, config);
    expect(result.countedTimestampsMs).toEqual([1000]);
    expect(result.triggered).toBe(false);
  });

  it('sorts the counted timestamps ascending even when input arrives out of order', () => {
    // Deliberately scrambled input — proves the function sorts by value
    // instead of trusting (or silently preserving) array/insertion order.
    const result = evaluateSlidingWindow([20000, 9999, 15000, 10000], 20000, config);
    expect(result.countedTimestampsMs).toEqual([10000, 15000, 20000]);
  });
});

describe('detectMultiStageAttack', () => {
  const windowMs = 60_000;

  it('detects the canonical silence -> anomalous traffic -> privileged access sequence', () => {
    const events = [
      { kind: 'NODE_SILENCE' as const, timestampMs: 0 },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 10_000 },
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: 20_000 },
    ];
    expect(detectMultiStageAttack(events, windowMs)).toBe(true);
  });

  it('ignores unrelated noise events interleaved between stages', () => {
    const events = [
      { kind: 'NODE_SILENCE' as const, timestampMs: 0 },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 5_000 }, // will be consumed as stage 2
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 10_000 },
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: 20_000 },
    ];
    expect(detectMultiStageAttack(events, windowMs)).toBe(true);
  });

  it('rejects out-of-order stages', () => {
    const events = [
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: 0 },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 10_000 },
      { kind: 'NODE_SILENCE' as const, timestampMs: 20_000 },
    ];
    expect(detectMultiStageAttack(events, windowMs)).toBe(false);
  });

  it('rejects a sequence that spans longer than the window', () => {
    const events = [
      { kind: 'NODE_SILENCE' as const, timestampMs: 0 },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 30_000 },
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: 70_000 },
    ];
    expect(detectMultiStageAttack(events, windowMs)).toBe(false);
  });

  it('rejects an incomplete sequence', () => {
    const events = [
      { kind: 'NODE_SILENCE' as const, timestampMs: 0 },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 10_000 },
    ];
    expect(detectMultiStageAttack(events, windowMs)).toBe(false);
  });

  it('returns false for an empty event list', () => {
    expect(detectMultiStageAttack([], windowMs)).toBe(false);
  });

  it('sorts out-of-order input before evaluating the sequence', () => {
    const events = [
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: 20_000 },
      { kind: 'NODE_SILENCE' as const, timestampMs: 0 },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 10_000 },
    ];
    expect(detectMultiStageAttack(events, 60_000)).toBe(true);
  });

  it('keeps evaluating after the sequence completes (extra trailing event)', () => {
    const events = [
      { kind: 'NODE_SILENCE' as const, timestampMs: 0 },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: 10_000 },
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: 20_000 },
      { kind: 'NODE_SILENCE' as const, timestampMs: 25_000 }, // trailing noise after completion
    ];
    expect(detectMultiStageAttack(events, 60_000)).toBe(true);
  });

  it('tracks the first-stage timestamp correctly at a large non-zero base, and allows a gap exactly equal to the window', () => {
    // Timestamps starting near 0 accidentally hide a null->0 coercion bug:
    // if `firstStageTs` were never actually captured, `event.timestampMs - null`
    // still evaluates to a small, plausible-looking number when timestamps
    // start near 0. A large base timestamp is what actually exposes that class
    // of bug — see the exact incident this class of issue caused in K-DIRECTIVE
    // (Rogue AI deadline going stale in a busy queue).
    const base = 100_000;
    const events = [
      { kind: 'NODE_SILENCE' as const, timestampMs: base },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: base + 5_000 },
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: base + 10_000 }, // exactly at the window boundary
    ];
    expect(detectMultiStageAttack(events, 10_000)).toBe(true);
  });

  it('rejects when the gap from the first stage exceeds the window by just 1ms', () => {
    const base = 100_000;
    const events = [
      { kind: 'NODE_SILENCE' as const, timestampMs: base },
      { kind: 'ANOMALOUS_TRAFFIC' as const, timestampMs: base + 5_000 },
      { kind: 'PRIVILEGED_ACCESS_ATTEMPT' as const, timestampMs: base + 10_001 },
    ];
    expect(detectMultiStageAttack(events, 10_000)).toBe(false);
  });
});
