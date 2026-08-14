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
});
