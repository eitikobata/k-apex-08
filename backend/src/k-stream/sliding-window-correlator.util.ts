/**
 * Pure sliding-window correlation. No I/O — given a list of recent event
 * timestamps (already filtered to "same node" or "same correlation tag" by
 * the caller) and a window/threshold config, decides whether they add up to
 * an incident. Kept side-effect-free on purpose: this is the piece most
 * worth mutation-testing, since a boundary bug here (`>` vs `>=`, off-by-one
 * on window edges) directly changes whether real "attacks" get caught.
 */
export interface CorrelationConfig {
  /** Sliding window size in ms. */
  windowMs: number;
  /** Minimum number of events inside the window to raise an incident. */
  threshold: number;
}

export interface CorrelationResult {
  triggered: boolean;
  /** Events that fell inside the window and counted toward the decision. */
  countedTimestampsMs: number[];
}

/**
 * `eventTimestampsMs` need not be sorted or deduplicated by the caller —
 * this function normalizes both.
 */
export function evaluateSlidingWindow(
  eventTimestampsMs: number[],
  nowMs: number,
  config: CorrelationConfig,
): CorrelationResult {
  const windowStart = nowMs - config.windowMs;
  const counted = [...new Set(eventTimestampsMs)]
    .filter((ts) => ts <= nowMs && ts >= windowStart)
    .sort((a, b) => a - b);

  return {
    triggered: counted.length >= config.threshold,
    countedTimestampsMs: counted,
  };
}

/**
 * Detects the specific "multi-stage attack" shape called out in the brief:
 * node silence -> anomalous traffic on a neighbor -> privileged access
 * attempt, all within the window and in that relative order. Stricter than
 * the generic threshold check above — order matters, not just count.
 */
export type StageKind = 'NODE_SILENCE' | 'ANOMALOUS_TRAFFIC' | 'PRIVILEGED_ACCESS_ATTEMPT';

export interface StageEvent {
  kind: StageKind;
  timestampMs: number;
}

const EXPECTED_SEQUENCE: StageKind[] = ['NODE_SILENCE', 'ANOMALOUS_TRAFFIC', 'PRIVILEGED_ACCESS_ATTEMPT'];

export function detectMultiStageAttack(events: StageEvent[], windowMs: number): boolean {
  const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs);

  // Walk the sorted events looking for the expected stages appearing in
  // order (not necessarily contiguous — noise in between is fine), all
  // within `windowMs` of the first stage.
  let stageIndex = 0;
  let firstStageTs: number | null = null;

  for (const event of sorted) {
    // Stryker disable next-line ConditionalExpression,EqualityOperator: confirmed
    // equivalent mutant. Once stageIndex reaches EXPECTED_SEQUENCE.length,
    // EXPECTED_SEQUENCE[stageIndex] is undefined, so `event.kind !== undefined`
    // is true for every remaining event and the loop just skips them via
    // `continue` anyway — removing this break produces byte-identical
    // results, just with a few harmless extra loop iterations.
    if (stageIndex >= EXPECTED_SEQUENCE.length) break;
    if (event.kind !== EXPECTED_SEQUENCE[stageIndex]) continue;

    if (firstStageTs === null) {
      firstStageTs = event.timestampMs;
    } else if (event.timestampMs - firstStageTs > windowMs) {
      // Sequence took too long — does not count as one correlated attack.
      return false;
    }
    stageIndex += 1;
  }

  return stageIndex === EXPECTED_SEQUENCE.length;
}
