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
  // NOTE: LATCH used to always self-resolve here ("low severity", no
  // operator involvement at all, autonomous or not) — that meant LATCH
  // incidents never reached AWAITING_OPERATOR, never showed up in the
  // console, and the operator never got to interact with them. Now every
  // tier follows the same rule: requires the operator unless autonomous
  // mode is active. LATCH still gets the lightest action (FLAG_ONLY) and,
  // on the frontend, the least typing friction — the escalation is in
  // effort required, not in whether the operator is involved at all.
  const actionType: KuroIceActionType = tier === 'LATCH' ? 'FLAG_ONLY' : tier === 'SPLICE' ? 'BLOCK_TRAFFIC' : 'ISOLATE_NODE';

  if (autonomousModeActive) {
    return { requiresOperator: false, actionType, autonomous: true };
  }

  return { requiresOperator: true, actionType, autonomous: false };
}
