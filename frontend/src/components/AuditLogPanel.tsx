'use client';

import { useEffect, useState } from 'react';
import { ApiError, BlacktapeEntryDto, kBlacktapeApi } from '@/lib/api-client';

const CATEGORIES = ['ALL', 'AUTH', 'INCIDENT', 'KURO_ICE', 'K_SILENCE', 'K_DIRECTIVE', 'ROGUE_AI'] as const;
const PAGE_SIZE = 50;

// GET /k-blacktape/entries is real, with real cursor pagination now
// (createdAt + id, not offset — offset silently skips/repeats rows on a
// fast-moving append-only table like this one).
export function AuditLogPanel({ accessToken }: { accessToken: string }) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('ALL');
  const [entries, setEntries] = useState<BlacktapeEntryDto[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadFirstPage() {
    setError(null);
    setEntries([]);
    setHasMore(true);
    kBlacktapeApi
      .listEntries(accessToken, { category: category === 'ALL' ? undefined : category, limit: PAGE_SIZE })
      .then((list) => {
        setEntries(list);
        setHasMore(list.length === PAGE_SIZE);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'GET /k-blacktape/entries unreachable — check the backend is running.'
            : err instanceof Error
              ? err.message
              : 'Failed to load audit log.',
        );
      });
  }

  useEffect(loadFirstPage, [accessToken, category]);

  async function loadMore() {
    const last = entries[entries.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await kBlacktapeApi.listEntries(accessToken, {
        category: category === 'ALL' ? undefined : category,
        limit: PAGE_SIZE,
        before: { createdAt: last.createdAt, id: last.id },
      });
      setEntries((prev) => [...prev, ...next]);
      setHasMore(next.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more.');
    } finally {
      setLoadingMore(false);
    }
  }

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

      <div className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 && !error && <span className="text-ash">No entries for this filter.</span>}
        {entries.map((e) => (
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
        ))}
        {hasMore && entries.length > 0 && (
          <button
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="mt-3 w-full border border-ash text-ash font-display tracking-widest uppercase text-[10px] py-1.5 hover:border-ash-bright hover:text-ash-bright transition-colors disabled:opacity-40"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
