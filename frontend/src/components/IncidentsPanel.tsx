'use client';

export interface IncidentRecord {
  id: string;
  tier: 'LATCH' | 'SPLICE' | 'SHATTER';
  status: 'AWAITING_OPERATOR' | 'ROGUE_AI_ACTIVE' | 'RESOLVED' | 'ESCALATED';
  rogueAi: boolean;
  createdAt: string;
  updatedAt: string;
  // NOTE (honesty flag / alarm fatigue): the frontend can't tell WHICH node
  // or WHAT KIND of incident this is — INCIDENT_AWAITING_OPERATOR only ever
  // sends { incidentId, tier, rogueAi? }, never a description. Fatigue is
  // therefore tracked per-tier (consecutive unconfirmed LATCH incidents),
  // not per-node like the brief describes ("same noisy node"), because the
  // node identity simply isn't on the wire yet. See ConsolePage's fatigue
  // counter. Incident.alarmFatigueDeprioritized already exists in the
  // Prisma schema but nothing sets it server-side — this flag is a
  // client-only, session-scoped approximation.
  deprioritized?: boolean;
}

// NOTE (honesty flag): mockup rows show a description like "Node silent
// after 3 retry attempts — NODE-14" — that text needs `kind`/node fields
// the backend doesn't broadcast today. Rows here show what's real (tier,
// id, status, elapsed) and skip the description rather than invent one.
export function IncidentsPanel({
  incidents,
  onRowClick,
  onCopyToTerminal,
}: {
  incidents: IncidentRecord[];
  onRowClick: (incident: IncidentRecord) => void;
  onCopyToTerminal: (text: string) => void;
}) {
  const active = incidents.filter((i) => !i.deprioritized);
  const deprioritized = incidents.filter((i) => i.deprioritized);
  const sorted = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {sorted.length === 0 && <span className="text-ash">No incidents this session.</span>}
        {sorted.map((inc) => (
          <IncidentRow key={inc.id} incident={inc} onClick={() => onRowClick(inc)} onCopyToTerminal={onCopyToTerminal} />
        ))}
      </div>

      {deprioritized.length > 0 && (
        <div className="mt-3 pt-2 border-t border-dashed border-grid opacity-50">
          <div className="text-[10px] text-ash tracking-widest uppercase mb-1">
            Deprioritized (alarm fatigue — repeated LATCH ignored)
          </div>
          {deprioritized.map((inc) => (
            <div key={inc.id} className="scale-95 origin-left">
              <IncidentRow incident={inc} onClick={() => onRowClick(inc)} onCopyToTerminal={onCopyToTerminal} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentRow({
  incident,
  onClick,
  onCopyToTerminal,
}: {
  incident: IncidentRecord;
  onClick: () => void;
  onCopyToTerminal: (text: string) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-1 py-2 border-b border-grid hover:bg-grid/30 transition-colors ${
        incident.rogueAi && incident.status !== 'RESOLVED' ? 'bg-danger/5' : ''
      }`}
    >
      <button onClick={onClick} className="flex items-center gap-2 flex-1 min-w-0 text-left">
        <TierBadge tier={incident.tier} />
        <span className="text-ash font-mono truncate">#{incident.id}</span>
      </button>
      <StatusLabel status={incident.status} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCopyToTerminal(`//${incident.id}`);
        }}
        title={`Copy //${incident.id} to terminal`}
        className="shrink-0 border border-ash text-ash text-[9px] px-1.5 py-0.5 hover:border-signal hover:text-signal transition-colors"
      >
        Copy to terminal
      </button>
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
  return <span className={`${map[status]} text-right`}>{status.replace(/_/g, ' ')}</span>;
}
