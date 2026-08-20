'use client';

import { useEffect, useState } from 'react';
import { TierBadge } from './TierBadge';

export interface IncidentRecord {
  id: string;
  tier: 'LATCH' | 'SPLICE' | 'SHATTER';
  status: 'AWAITING_OPERATOR' | 'ROGUE_AI_ACTIVE' | 'RESOLVED' | 'ESCALATED';
  rogueAi: boolean;
  rogueAiIncidentId?: string;
  // Only present for SPLICE incidents raised by K-SILENCE (kind
  // NODE_SILENCE) — which specific node this is about. Absent for every
  // other incident type; INCIDENT_AWAITING_OPERATOR only carries it when
  // K-DIRECTIVE found a matching SilenceState (see the backend note there).
  nodeCode?: string;
  createdAt: string;
  updatedAt: string;
}

// AI-resolve odds — flavor only, no API call (see handleAiResolved in
// console/page.tsx). Kept internal, never shown to the operator — see
// SHOW_AI_ODDS below.
const AI_RESOLVE_ODDS: Partial<Record<IncidentRecord['tier'], number>> = {
  LATCH: 0.8,
  SPLICE: 0.15,
  // SHATTER deliberately has no entry — no AI-resolve option at all, the
  // escalation in severity means fewer safety nets, not just more typing.
};

// NOTE (honesty flag): this mirrors the visual language of Rogue AI's
// countdown (RogueAiPanel). Unlike Rogue AI's stepDeadlineAt, this now
// DOES have real backend enforcement — Incident.operatorDeadlineAt +
// KDirectiveService.sweepExpiredOperatorDeadlines mark the incident
// ESCALATED server-side when this hits zero, matching what the bar shows.
// TIER_TIMER_MS here must stay in sync with OPERATOR_DEADLINE_MS in
// k-directive.service.ts if either changes.
const TIER_TIMER_MS: Record<IncidentRecord['tier'], number> = {
  LATCH: 90_000,
  SPLICE: 60_000,
  SHATTER: 30_000,
};

// Set to false to hide the inline "type X then click" hint per row — keep
// it on while testing, turn it off once the Instructions panel alone is
// enough to teach the flow.
const SHOW_INLINE_HINTS = true;

// NOTE (design decision, no modal anymore): every action lives directly in
// the row. Difficulty scales by tier through how much the operator has to
// type BY HAND before appending the ID — the button always appends the
// same thing (`//<id>`). Kind/Node fields from earlier mockups aren't
// shown — INCIDENT_AWAITING_OPERATOR doesn't carry them.
export function IncidentsPanel({
  incidents,
  onCopyToTerminal,
  onOpenCase,
  onAiResolved,
  readOnly = false,
}: {
  incidents: IncidentRecord[];
  onCopyToTerminal: (text: string) => void;
  onOpenCase: (incidentId: string) => void;
  onAiResolved: (incidentId: string) => void;
  readOnly?: boolean;
}) {
  // Pending (needs a response) always sorts above resolved/escalated,
  // regardless of when either happened — an old unresolved incident should
  // never get buried under a freshly-resolved one. Within "pending",
  // oldest first (arrival order — first come, first handled). Within
  // "done", most recently touched first (most useful for a quick
  // "what just wrapped up" glance).
  const sorted = [...incidents].sort((a, b) => {
    const aPending = a.status === 'AWAITING_OPERATOR' || a.status === 'ROGUE_AI_ACTIVE';
    const bPending = b.status === 'AWAITING_OPERATOR' || b.status === 'ROGUE_AI_ACTIVE';
    if (aPending !== bPending) return aPending ? -1 : 1;
    return aPending ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt);
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col text-xs">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {sorted.length === 0 && <span className="text-ash">No incidents this session.</span>}
        {sorted.map((inc) => (
          <IncidentRow
            key={inc.id}
            incident={inc}
            onCopyToTerminal={onCopyToTerminal}
            onOpenCase={onOpenCase}
            onAiResolved={onAiResolved}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

function IncidentRow({
  incident,
  onCopyToTerminal,
  onOpenCase,
  onAiResolved,
  readOnly,
}: {
  incident: IncidentRecord;
  onCopyToTerminal: (text: string) => void;
  onOpenCase: (incidentId: string) => void;
  onAiResolved: (incidentId: string) => void;
  readOnly: boolean;
}) {
  const [aiState, setAiState] = useState<'idle' | 'trying' | 'failed'>('idle');
  const [now, setNow] = useState(() => Date.now());
  const aiOdds = AI_RESOLVE_ODDS[incident.tier];
  const actionable = incident.status === 'AWAITING_OPERATOR';
  // Rogue AI rows aren't "actionable" here (that happens in the floating
  // overlay, not this row), but they're just as unresolved — both get the
  // blink.
  const unresolved = incident.status === 'AWAITING_OPERATOR' || incident.status === 'ROGUE_AI_ACTIVE';

  useEffect(() => {
    if (!actionable) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [actionable]);

  function tryAiResolve() {
    if (aiOdds === undefined || aiState === 'trying') return;
    setAiState('trying');
    // Pure flavor — no API call, see the honesty flag on handleAiResolved
    // in console/page.tsx. A "success" here flips the row to RESOLVED
    // locally (stops the timer, matches what the operator sees) but the
    // real backend Incident stays whatever it actually is.
    setTimeout(() => {
      if (Math.random() < aiOdds) {
        onAiResolved(incident.id);
      } else {
        setAiState('failed');
      }
    }, 1600 + Math.random() * 900);
  }

  const windowMs = TIER_TIMER_MS[incident.tier];
  const elapsedMs = now - new Date(incident.createdAt).getTime();
  const remainingMs = Math.max(0, windowMs - elapsedMs);
  const pct = Math.round((remainingMs / windowMs) * 100);

  return (
    <div
      className={`flex flex-col gap-1.5 px-1 py-2 border-b border-grid ${
        unresolved ? 'incident-row-blink' : incident.rogueAi ? 'bg-danger/5' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <TierBadge tier={incident.tier} />
        {incident.nodeCode && (
          <span className="text-warn text-[10px] font-display tracking-wider">{incident.nodeCode}</span>
        )}
        <span className="text-ash font-mono truncate flex-1">#{incident.id}</span>
        <StatusLabel status={incident.status} />
      </div>

      {actionable && (
        <div className="h-1 bg-grid">
          <div
            className={`h-full transition-[width] ${pct < 20 ? 'bg-danger' : pct < 50 ? 'bg-warn' : 'bg-ash'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {actionable && !readOnly && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onCopyToTerminal(`//${incident.id}`)}
            className={`border font-display tracking-widest uppercase text-[10px] px-2.5 py-1 transition-colors ${
              incident.tier === 'SHATTER'
                ? 'border-danger text-danger hover:bg-danger hover:text-void'
                : incident.tier === 'SPLICE'
                  ? 'border-warn text-warn hover:bg-warn hover:text-void'
                  : 'border-signal text-signal hover:bg-signal hover:text-void'
            }`}
          >
            {incident.tier}
          </button>
          {SHOW_INLINE_HINTS && (
            <span className="text-ash text-[10px]">
              type <span className="text-ash-bright">{`CONFIRM${incident.tier === 'LATCH' ? '' : ` ${incident.tier}`} `}</span>
              first, then click
            </span>
          )}

          {aiOdds !== undefined && aiState === 'idle' && (
            <button
              onClick={tryAiResolve}
              className="border border-ash text-ash font-display tracking-widest uppercase text-[10px] px-2.5 py-1 hover:border-ash-bright hover:text-ash-bright transition-colors ml-auto"
            >
              AI resolves
            </button>
          )}
          {aiState === 'trying' && (
            <div className="ml-auto w-28 h-1.5 bg-grid overflow-hidden">
              <div className="h-full w-1/3 bg-ash animate-[ai-resolve-bar_1.4s_ease-in-out_infinite]" />
            </div>
          )}
          {aiState === 'failed' && <span className="ml-auto text-danger text-[10px]">AI failed — your call</span>}
        </div>
      )}

      {actionable && readOnly && (
        <span className="text-ash text-[10px] italic">Read-only — observer accounts can&apos;t act on incidents</span>
      )}

      {(incident.status === 'RESOLVED' || incident.status === 'ESCALATED') && (
        <button
          onClick={() => onOpenCase(incident.id)}
          className="self-start border border-ash text-ash text-[10px] px-2 py-0.5 hover:border-ash-bright hover:text-ash-bright transition-colors"
        >
          View in K-BLACKBOX
        </button>
      )}
    </div>
  );
}


function StatusLabel({ status }: { status: IncidentRecord['status'] }) {
  const map: Record<IncidentRecord['status'], string> = {
    AWAITING_OPERATOR: 'text-warn',
    ROGUE_AI_ACTIVE: 'text-danger',
    RESOLVED: 'text-signal',
    ESCALATED: 'text-danger',
  };
  return <span className={`${map[status]} text-right shrink-0`}>{status.replace(/_/g, ' ')}</span>;
}
