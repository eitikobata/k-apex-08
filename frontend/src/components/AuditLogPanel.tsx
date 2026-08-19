'use client';

import { useEffect, useState } from 'react';
import { ApiError, BlacktapeEntryDto, kBlacktapeApi } from '@/lib/api-client';

const CATEGORIES = ['ALL', 'AUTH', 'INCIDENT', 'KURO_ICE', 'K_SILENCE', 'K_DIRECTIVE', 'ROGUE_AI'] as const;

// NOTE (honesty flag): no REST endpoint reads BlacktapeEntry rows yet.
// BlacktapeService already writes them on the backend (auth events,
// resolutions, Rogue AI transitions, KURO-ICE actions) — this panel is
// wired against the natural GET /k-blacktape/entries contract so it starts
// working the moment that lands, same pattern as the admin operators list.
export function AuditLogPanel({ accessToken }: { accessToken: string }) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('ALL');
  const [entries, setEntries] = useState<BlacktapeEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    kBlacktapeApi
      .listEntries(accessToken, category === 'ALL' ? undefined : category)
      .then((list) => setEntries(list))
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'GET /k-blacktape/entries not deployed yet — this log will populate once it exists.'
            : err instanceof Error
              ? err.message
              : 'Failed to load audit log.',
        );
      });
  }, [accessToken, category]);

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex gap-2 flex-wrap mb-3 shrink-0">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`border font-display text-[10px] tracking-widest uppercase px-2.5 py-1 transition-colors ${
              category === c ? 'border-signal text-signal' : 'border-grid text-ash hover:border-ash-bright hover:text-ash-bright'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {error && <p className="text-warn shrink-0 mb-2">{error}</p>}

      {entries && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {entries.length === 0 ? (
            <span className="text-ash">No entries for this filter.</span>
          ) : (
            entries.map((e) => (
              <div
                key={e.id}
                className="grid grid-cols-[150px_110px_1fr_140px] gap-2 py-1.5 border-b border-grid text-ash-bright"
              >
                <span className="text-ash">{new Date(e.createdAt).toLocaleString()}</span>
                <span className="text-danger text-[10px]">{e.category}</span>
                <span>{e.action}</span>
                <span className="text-ash">
                  {e.actorType}
                  {e.actorId ? ` (${e.actorId.slice(0, 8)}…)` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
