/**
 * K-DIRECTIVE's core decision rule. Deliberately pure and deterministic —
 * this is the "fast engine that can't depend on an external API" from the
 * brief. AI enrichment (K-BLACKBOX summaries) lives entirely outside this
 * function and never influences its output.
 */
export type ThreatTier = 'LATCH' | 'SPLICE' | 'SHATTER';
export type KuroIceActionType = 'FLAG_ONLY' | 'BLOCK_TRAFFIC' | 'ISOLATE_NODE' | 'PREEMPTIVE_NODE_LOCKDOWN';

export interface DecisionResult {
  requiresOperator: boolean;
  actionType: KuroIceActionType;
  autonomous: boolean;
}

export function decideIncidentHandling(tier: ThreatTier, autonomousModeActive: boolean): DecisionResult {
  if (tier === 'LATCH') {
    // Low severity always self-resolves, autonomous mode or not.
    return { requiresOperator: false, actionType: 'FLAG_ONLY', autonomous: autonomousModeActive };
  }

  const actionType: KuroIceActionType = tier === 'SPLICE' ? 'BLOCK_TRAFFIC' : 'ISOLATE_NODE';

  if (autonomousModeActive) {
    return { requiresOperator: false, actionType, autonomous: true };
  }

  return { requiresOperator: true, actionType, autonomous: false };
}
