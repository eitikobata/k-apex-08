'use client';

import { useEffect, useState } from 'react';
import { ApiError, BlacktapeEntryDto, kBlacktapeApi } from '@/lib/api-client';

const CATEGORIES = ['AUTH', 'INCIDENT', 'KURO_ICE', 'K_SILENCE', 'K_DIRECTIVE', 'ROGUE_AI'] as const;

// NOTE (honesty flag): no REST endpoint reads BlacktapeEntry rows yet.
// BlacktapeService is already writing them on the backend (auth events,
// resolutions, Rogue AI transitions, KURO-ICE actions) — this panel is
// wired against the natural GET /k-blacktape/entries contract so it starts
// working the moment that lands, same pattern as the admin operators list.
export function AuditLogPanel({ accessToken }: { accessToken: string }) {
  const [category, setCategory] = useState<string>('');
  const [entries, setEntries] = useState<BlacktapeEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    kBlacktapeApi
      .listEntries(accessToken, category || undefined)
      .then((list) => setEntries(list))
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'Backend endpoint not deployed yet — this log will populate once GET /k-blacktape/entries exists.'
            : err instanceof Error
              ? err.message
              : 'Failed to load audit log.',
        );
      });
  }, [accessToken, category]);

  return (
    <div className="p-3 h-full flex flex-col gap-2 text-xs">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-ash">Immutable audit trail — every category is append-only.</p>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-void panel-border px-2 py-1 text-ash-bright outline-none focus:border-signal text-[10px]"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-warn shrink-0">{error}</p>}

      {entries && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {entries.length === 0 ? (
            <span className="text-ash">No entries for this filter.</span>
          ) : (
            <table className="w-full text-left font-mono">
              <thead>
                <tr className="border-b border-grid text-ash uppercase tracking-wider">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Category</th>
                  <th className="py-1 pr-3">Action</th>
                  <th className="py-1 pr-3">Actor</th>
                  <th className="py-1 pr-3">Target</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-grid/50 text-ash-bright">
                    <td className="py-1.5 pr-3 text-ash">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{e.category}</td>
                    <td className="py-1.5 pr-3">{e.action}</td>
                    <td className="py-1.5 pr-3 text-ash">
                      {e.actorType}
                      {e.actorId ? ` (${e.actorId.slice(0, 8)}…)` : ''}
                    </td>
                    <td className="py-1.5 pr-3 text-ash">
                      {e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8) ?? ''}…` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
