'use client';

import { useMemo, useState } from 'react';

export interface IncidentRecord {
  id: string;
  tier: 'LATCH' | 'SPLICE' | 'SHATTER';
  status: 'AWAITING_OPERATOR' | 'ROGUE_AI_ACTIVE' | 'RESOLVED' | 'ESCALATED';
  rogueAi: boolean;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = 'ALL' | IncidentRecord['status'];

// NOTE (honesty flag): this list is built entirely from live socket events
// (INCIDENT_AWAITING_OPERATOR, ROGUE_AI_TRANSITION, ROGUE_AI_RESOLVED_AUTONOMOUSLY)
// accumulated client-side by ConsolePage — see the reducer logic there. It's
// real, current data, but session-scoped: reload the tab and history is
// gone. Backfilling past incidents needs GET /k-stream/incidents (see
// kStreamApi.listIncidents in api-client.ts), which doesn't exist yet.
export function IncidentsPanel({
  incidents,
  onOpenCase,
}: {
  incidents: IncidentRecord[];
  onOpenCase: (incidentId: string) => void;
}) {
  const [filter, setFilter] = useState<StatusFilter>('ALL');

  const filtered = useMemo(() => {
    const list = filter === 'ALL' ? incidents : incidents.filter((i) => i.status === filter);
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [incidents, filter]);

  return (
    <div className="p-3 h-full flex flex-col gap-2 text-xs">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-ash">
          {incidents.length} incident{incidents.length === 1 ? '' : 's'} this session
        </p>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as StatusFilter)}
          className="bg-void panel-border px-2 py-1 text-ash-bright outline-none focus:border-signal text-[10px]"
        >
          <option value="ALL">All statuses</option>
          <option value="AWAITING_OPERATOR">Awaiting operator</option>
          <option value="ROGUE_AI_ACTIVE">Rogue AI active</option>
          <option value="RESOLVED">Resolved</option>
          <option value="ESCALATED">Escalated</option>
        </select>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 && <span className="text-ash">No incidents match this filter.</span>}
        {filtered.length > 0 && (
          <table className="w-full text-left font-mono">
            <thead>
              <tr className="border-b border-grid text-ash uppercase tracking-wider">
                <th className="py-1 pr-3">Tier</th>
                <th className="py-1 pr-3">Incident</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Updated</th>
                <th className="py-1 pr-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inc) => (
                <tr key={inc.id} className="border-b border-grid/50 text-ash-bright">
                  <td className={`py-1.5 pr-3 ${tierClass(inc.tier)}`}>{inc.tier}</td>
                  <td className="py-1.5 pr-3">{inc.id.slice(0, 8)}…</td>
                  <td className="py-1.5 pr-3">
                    <StatusPill status={inc.status} />
                  </td>
                  <td className="py-1.5 pr-3 text-ash">
                    {new Date(inc.updatedAt).toLocaleTimeString()}
                  </td>
                  <td className="py-1.5 pr-3">
                    <button
                      onClick={() => onOpenCase(inc.id)}
                      className="border border-signal text-signal px-2 py-0.5 hover:bg-signal hover:text-void transition-colors"
                    >
                      Open in K-BLACKBOX
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function tierClass(tier: IncidentRecord['tier']): string {
  if (tier === 'SHATTER') return 'text-danger';
  if (tier === 'SPLICE') return 'text-warn';
  return 'text-signal';
}

function StatusPill({ status }: { status: IncidentRecord['status'] }) {
  const map: Record<IncidentRecord['status'], string> = {
    AWAITING_OPERATOR: 'text-warn',
    ROGUE_AI_ACTIVE: 'text-danger',
    RESOLVED: 'text-signal',
    ESCALATED: 'text-danger',
  };
  return <span className={map[status]}>{status.replace(/_/g, ' ')}</span>;
}
