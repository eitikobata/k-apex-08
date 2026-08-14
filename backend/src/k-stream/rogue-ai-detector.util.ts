/**
 * Rogue-AI events carry a `driftFactor` (0..1) in their signature vector,
 * meant to represent a pattern that mutates over time to dodge a simple
 * static-threshold detector — the whole point of it being the "scariest"
 * intrusion type per the brief. This is the second-pass detector: cheap to
 * run, only invoked when a correlationTag has accumulated enough
 * ROGUE_AI_SIGNATURE samples to bother checking.
 */
export interface DetectorOptions {
  minSamples: number;
  minTotalDrift: number;
  /** How many out-of-order (decreasing) samples are tolerated before rejecting. */
  maxRegressions: number;
}

export const DEFAULT_ROGUE_AI_DETECTOR_OPTIONS: DetectorOptions = {
  minSamples: 3,
  minTotalDrift: 0.5,
  maxRegressions: 1,
};

export function detectRogueAiAdaptiveSignature(
  driftFactorsInOrder: number[],
  options: DetectorOptions = DEFAULT_ROGUE_AI_DETECTOR_OPTIONS,
): boolean {
  if (driftFactorsInOrder.length < options.minSamples) return false;

  let regressions = 0;
  for (let i = 1; i < driftFactorsInOrder.length; i += 1) {
    if (driftFactorsInOrder[i] < driftFactorsInOrder[i - 1]) {
      regressions += 1;
    }
  }
  if (regressions > options.maxRegressions) return false;

  const totalDrift = driftFactorsInOrder[driftFactorsInOrder.length - 1] - driftFactorsInOrder[0];
  return totalDrift >= options.minTotalDrift;
}
