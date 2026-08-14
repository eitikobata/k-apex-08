import { detectRogueAiAdaptiveSignature, DEFAULT_ROGUE_AI_DETECTOR_OPTIONS } from './rogue-ai-detector.util';

describe('detectRogueAiAdaptiveSignature', () => {
  it('rejects fewer samples than minSamples', () => {
    expect(detectRogueAiAdaptiveSignature([0, 0.9])).toBe(false);
  });

  it('detects a clean ascending drift', () => {
    expect(detectRogueAiAdaptiveSignature([0, 0.3, 0.6, 1])).toBe(true);
  });

  it('rejects flat/no-drift samples even with enough count', () => {
    expect(detectRogueAiAdaptiveSignature([0.2, 0.2, 0.2, 0.2])).toBe(false);
  });

  it('tolerates exactly maxRegressions dips and still detects drift', () => {
    expect(detectRogueAiAdaptiveSignature([0, 0.5, 0.4, 0.9])).toBe(true);
  });

  it('rejects when regressions exceed maxRegressions', () => {
    expect(detectRogueAiAdaptiveSignature([0, 0.5, 0.3, 0.2, 0.9])).toBe(false);
  });

  it('rejects total drift below minTotalDrift', () => {
    expect(detectRogueAiAdaptiveSignature([0, 0.1, 0.2, 0.3])).toBe(false);
  });

  it('respects custom options', () => {
    const opts = { minSamples: 2, minTotalDrift: 0.1, maxRegressions: 0 };
    expect(detectRogueAiAdaptiveSignature([0, 0.15], opts)).toBe(true);
    expect(detectRogueAiAdaptiveSignature([0.15, 0], opts)).toBe(false);
  });

  it('exports sane defaults', () => {
    expect(DEFAULT_ROGUE_AI_DETECTOR_OPTIONS.minSamples).toBeGreaterThan(0);
  });
});
