'use client';

import { useEffect, useState } from 'react';

export interface IncidentRecord {
  id: string;
  tier: 'LATCH' | 'SPLICE' | 'SHATTER';
  status: 'AWAITING_OPERATOR' | 'ROGUE_AI_ACTIVE' | 'RESOLVED' | 'ESCALATED';
  rogueAi: boolean;
  rogueAiIncidentId?: string;
  createdAt: string;
  updatedAt: string;
  // NOTE (honesty flag / alarm fatigue): the frontend can't tell WHICH node
  // or WHAT KIND of incident this is — INCIDENT_AWAITING_OPERATOR only ever
  // sends { incidentId, tier, rogueAi? }, never a description. Fatigue is
  // therefore tracked per-tier (consecutive unconfirmed LATCH incidents),
  // not per-node like the brief describes, because node identity isn't on
  // the wire yet. See ConsolePage's fatigue counter.
  deprioritized?: boolean;
}

// AI-resolve odds — flavor only, no API call (see AiResolveButton below).
const AI_RESOLVE_ODDS: Partial<Record<IncidentRecord['tier'], number>> = {
  LATCH: 0.6,
  SPLICE: 0.15,
  // SHATTER deliberately has no entry — no AI-resolve option at all, the
  // escalation in severity means fewer safety nets, not just more typing.
};

// NOTE (honesty flag): this mirrors the visual language of Rogue AI's
// countdown (RogueAiPanel), but unlike Rogue AI's stepDeadlineAt, there is
// NO backend deadline for regular KURO-ICE confirmations — Incident has no
// deadline column, and nothing sweeps for expiry the way rogue-ai.service.ts
// does. This is purely a visual "time budget" computed client-side from
// createdAt, with NO consequence when it hits zero (no escalation, no
// auto-resolve, it just sits at 0:00). Adding a real one needs a schema
// migration (a new column + a sweep interval like Rogue AI's) — flagging
// this now rather than pretending it's enforced.
const TIER_TIMER_MS: Record<IncidentRecord['tier'], number> = {
  LATCH: 90_000,
  SPLICE: 60_000,
  SHATTER: 30_000,
};

// Set to false to hide the inline "type X then click" hint per row — keep
// it on while testing, turn it off once the Instructions panel alone is
// enough to teach the flow (matches the request: useful training wheels
// now, noise later).
const SHOW_INLINE_HINTS = true;

// NOTE (design decision, no modal anymore): every action lives directly in
// the row. Difficulty scales by tier through how much the operator has to
// type BY HAND before appending the ID — the button always appends the
// same thing (`//<id>`), see the honesty flag on onCopyToTerminal below.
// Kind/Node fields from earlier mockups aren't shown — INCIDENT_AWAITING_OPERATOR
// doesn't carry them (same limitation as before, just no longer hidden
// behind a modal that implied more detail than exists).
export function IncidentsPanel({
  incidents,
  onCopyToTerminal,
  onOpenCase,
}: {
  incidents: IncidentRecord[];
  onCopyToTerminal: (text: string) => void;
  onOpenCase: (incidentId: string) => void;
}) {
  const active = incidents.filter((i) => !i.deprioritized);
  const deprioritized = incidents.filter((i) => i.deprioritized);
  const sorted = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {sorted.length === 0 && <span className="text-ash">No incidents this session.</span>}
        {sorted.map((inc) => (
          <IncidentRow key={inc.id} incident={inc} onCopyToTerminal={onCopyToTerminal} onOpenCase={onOpenCase} />
        ))}
      </div>

      {deprioritized.length > 0 && (
        <div className="mt-3 pt-2 border-t border-dashed border-grid opacity-50">
          <div className="text-[10px] text-ash tracking-widest uppercase mb-1">
            Deprioritized (alarm fatigue — repeated LATCH ignored)
          </div>
          {deprioritized.map((inc) => (
            <div key={inc.id} className="scale-95 origin-left">
              <IncidentRow incident={inc} onCopyToTerminal={onCopyToTerminal} onOpenCase={onOpenCase} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentRow({
  incident,
  onCopyToTerminal,
  onOpenCase,
}: {
  incident: IncidentRecord;
  onCopyToTerminal: (text: string) => void;
  onOpenCase: (incidentId: string) => void;
}) {
  const [aiState, setAiState] = useState<'idle' | 'trying' | 'succeeded' | 'failed'>('idle');
  const [now, setNow] = useState(() => Date.now());
  const aiOdds = AI_RESOLVE_ODDS[incident.tier];
  const actionable = incident.status === 'AWAITING_OPERATOR';

  useEffect(() => {
    if (!actionable) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [actionable]);

  function tryAiResolve() {
    if (aiOdds === undefined || aiState === 'trying') return;
    setAiState('trying');
    // Pure flavor — no API call. See the honesty flag: a "succeeded" row
    // here does NOT resolve the incident server-side. The real incident
    // stays AWAITING_OPERATOR underneath regardless of the outcome shown
    // here; this is deliberately just tension/theater before the operator
    // decides whether to trust it or do it themselves.
    setTimeout(() => {
      setAiState(Math.random() < aiOdds ? 'succeeded' : 'failed');
    }, 1600 + Math.random() * 900);
  }

  const windowMs = TIER_TIMER_MS[incident.tier];
  const elapsedMs = now - new Date(incident.createdAt).getTime();
  const remainingMs = Math.max(0, windowMs - elapsedMs);
  const pct = Math.round((remainingMs / windowMs) * 100);

  return (
    <div
      className={`flex flex-col gap-1.5 px-1 py-2 border-b border-grid ${
        incident.rogueAi && incident.status !== 'RESOLVED' ? 'bg-danger/5' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <TierBadge tier={incident.tier} />
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

      {actionable && (
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
              AI resolves? ({Math.round(aiOdds * 100)}%)
            </button>
          )}
          {aiState === 'trying' && (
            <div className="ml-auto w-28 h-1.5 bg-grid overflow-hidden">
              <div className="h-full w-1/3 bg-ash animate-[ai-resolve-bar_1.4s_ease-in-out_infinite]" />
            </div>
          )}
          {aiState === 'succeeded' && (
            <span className="ml-auto text-signal text-[10px]">AI handled it (unverified — confirm if unsure)</span>
          )}
          {aiState === 'failed' && <span className="ml-auto text-danger text-[10px]">AI failed — your call</span>}
        </div>
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

function TierBadge({ tier }: { tier: IncidentRecord['tier'] }) {
  const cls =
    tier === 'SHATTER'
      ? 'text-danger border-danger bg-danger/10'
      : tier === 'SPLICE'
        ? 'text-warn border-warn'
        : 'text-signal border-signal';
  return (
    <span className={`inline-block font-display text-[10px] tracking-wider uppercase border px-1.5 py-0.5 ${cls}`}>
      {tier}
    </span>
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
