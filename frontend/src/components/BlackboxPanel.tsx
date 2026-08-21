'use client';

import { useEffect, useState } from 'react';
import { TierBadge } from './TierBadge';
import { TypewriterText } from './TypewriterText';
import { ApiError, CaseFileSummaryDto, kBlackboxApi } from '@/lib/api-client';
import { playSound } from '@/lib/sound-effects';
import type { IncidentRecord } from './IncidentsPanel';

const SKIPPED_MESSAGES: Record<string, string> = {
  NO_API_KEY: 'AI summaries are not configured on this deployment (no API key set).',
  CIRCUIT_OPEN: 'AI provider is temporarily unavailable (too many recent failures) — try again in a bit.',
  API_ERROR: 'AI provider request failed — try again in a bit.',
  INVALID_RESPONSE: "AI provider's response didn't pass validation twice in a row — try again, or open a different case.",
};

interface CaseRowData {
  incidentId: string;
  tier?: IncidentRecord['tier'];
  createdAt: string;
  aiSummary?: string | null;
}

// GET /k-blackbox/cases is real now (KBlackboxController) — falls back to
// resolved/escalated incidents from this session only if that call fails
// (network hiccup, deploy in progress), not because the endpoint doesn't
// exist anymore. Summarize, Replay, and text search are all real.
export function BlackboxPanel({
  accessToken,
  sessionIncidents,
  onOpenReplay,
}: {
  accessToken: string;
  sessionIncidents: IncidentRecord[];
  onOpenReplay: (incidentId: string) => void;
}) {
  const [remoteCases, setRemoteCases] = useState<CaseFileSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ incidentId: string; aiSummary: string | null; distance: number }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    kBlackboxApi
      .listCases(accessToken)
      .then((list) => setRemoteCases(list))
      .catch((err) => {
        setListError(
          err instanceof ApiError && err.status === 404
            ? 'GET /k-blackbox/cases unreachable — showing resolved incidents from this session instead.'
            : err instanceof Error
              ? err.message
              : 'Failed to load case archive.',
        );
      });
  }, [accessToken]);

  const rows: CaseRowData[] =
    remoteCases && remoteCases.length > 0
      ? remoteCases.map((c) => ({ incidentId: c.incidentId, createdAt: c.createdAt, aiSummary: c.aiSummary }))
      : sessionIncidents
          .filter((i) => i.status === 'RESOLVED' || i.status === 'ESCALATED')
          .map((i) => ({ incidentId: i.id, tier: i.tier, createdAt: i.updatedAt }));

  // Falls back to a search result if the selected id isn't in `rows` — a
  // case can show up in search before it's in the (session-limited or
  // 404-fallback) case list.
  const selectedFromSearch = searchResults?.find((r) => r.incidentId === selectedId);
  const selected: CaseRowData | null =
    rows.find((r) => r.incidentId === selectedId) ??
    (selectedFromSearch
      ? { incidentId: selectedFromSearch.incidentId, aiSummary: selectedFromSearch.aiSummary, createdAt: new Date().toISOString() } // createdAt unused by the detail pane below, just satisfies CaseRowData's shape
      : null) ??
    (searchResults === null ? rows[0] : null) ??
    null;

  async function summarize(incidentId: string) {
    setBusyId(incidentId);
    try {
      const result = await kBlackboxApi.summarize(accessToken, incidentId);
      const message =
        result.summary ??
        (result.skipped ? SKIPPED_MESSAGES[result.skipped] ?? `Summary unavailable (${result.skipped}).` : 'No summary returned.');
      setSummaries((prev) => ({ ...prev, [incidentId]: message }));
    } catch (err) {
      setSummaries((prev) => ({
        ...prev,
        [incidentId]: err instanceof Error ? `Error: ${err.message}` : 'Summarize failed.',
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function runSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await kBlackboxApi.searchByText(accessToken, q, 5);
      setSearchResults(results);
      if (results.length === 0) setSearchError('No matches — or AI enrichment is unavailable right now (no API key / circuit open).');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults(null);
    setSearchError(null);
  }

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full text-xs">
      <div className="flex flex-col min-h-0">
        {listError && <p className="text-warn mb-2">{listError}</p>}

        {searchResults !== null && (
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-ash text-[10px] tracking-widest uppercase">Search results</span>
            <button onClick={clearSearch} className="text-ash hover:text-ash-bright text-[10px]">
              clear ✕
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {searchResults !== null ? (
            <>
              {searchResults.length === 0 && !searchError && <p className="text-ash">No matches.</p>}
              {searchResults.map((r) => (
                <button
                  key={r.incidentId}
                  onClick={() => setSelectedId(r.incidentId)}
                  className={`w-full text-left px-2 py-2 border-b border-grid hover:bg-grid/30 transition-colors ${
                    selectedId === r.incidentId ? 'bg-signal/5 border-l-2 border-l-signal' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>#{r.incidentId.slice(0, 8)}…</span>
                    <span className="text-ash text-[10px]">match {(1 - r.distance).toFixed(2)}</span>
                  </div>
                  {r.aiSummary && <p className="text-ash text-[10px] mt-0.5 line-clamp-2">{r.aiSummary}</p>}
                </button>
              ))}
            </>
          ) : (
            <>
              {rows.length === 0 && <p className="text-ash">No resolved cases yet this session.</p>}
              {rows.map((r) => (
                <button
                  key={r.incidentId}
                  onClick={() => setSelectedId(r.incidentId)}
                  className={`w-full text-left px-2 py-2 border-b border-grid hover:bg-grid/30 transition-colors ${
                    selected?.incidentId === r.incidentId ? 'bg-signal/5 border-l-2 border-l-signal' : ''
                  }`}
                >
                  {r.tier ? <TierBadge tier={r.tier} /> : null} #{r.incidentId.slice(0, 8)}… —{' '}
                  {new Date(r.createdAt).toLocaleDateString()}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1 mt-3 pt-3 border-t border-dashed border-grid">
          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              placeholder="Search similar cases…"
              className="flex-1 bg-void panel-border px-2 py-1.5 text-ash-bright outline-none focus:border-signal"
            />
            <button
              onClick={() => void runSearch()}
              disabled={!searchQuery.trim() || searching}
              className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 hover:bg-signal hover:text-void transition-colors disabled:opacity-40"
            >
              {searching ? '…' : 'Search'}
            </button>
          </div>
          {searchError && <p className="text-warn text-[10px]">{searchError}</p>}
        </div>

        <div className="flex gap-2 mt-2">
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Open by incident ID…"
            className="flex-1 bg-void panel-border px-2 py-1.5 text-ash-bright outline-none focus:border-signal"
          />
          <button
            disabled={!manualId.trim()}
            onClick={() => setSelectedId(manualId.trim())}
            className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 hover:bg-signal hover:text-void transition-colors disabled:opacity-40"
          >
            Open
          </button>
        </div>
      </div>

      <div className="flex flex-col min-h-0">
        {!selected && <p className="text-ash">Select a case to see its detail.</p>}
        {selected && (
          <>
            {selected.tier && (
              <div className="flex justify-between border-b border-grid pb-1 mb-1">
                <span className="text-ash uppercase tracking-wider">Tier</span>
                <TierBadge tier={selected.tier} />
              </div>
            )}
            <Row label="Incident" value={`#${selected.incidentId.slice(0, 8)}…`} />
            <div className="flex-1 min-h-0 overflow-y-auto text-signal leading-relaxed py-3">
              {(() => {
                const summaryText = summaries[selected.incidentId] ?? selected.aiSummary;
                return summaryText ? (
                  <TypewriterText key={`${selected.incidentId}:${summaryText}`} text={summaryText} />
                ) : (
                  <span className="text-ash">No AI summary yet.</span>
                );
              })()}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  playSound('select');
                  summarize(selected.incidentId);
                }}
                onMouseEnter={() => playSound('hover')}
                disabled={busyId === selected.incidentId}
                className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 py-1.5 hover:bg-signal hover:text-void transition-colors disabled:opacity-40"
              >
                {busyId === selected.incidentId ? 'Working…' : 'Summarize'}
              </button>
              <button
                onClick={() => {
                  playSound('select');
                  onOpenReplay(selected.incidentId);
                }}
                onMouseEnter={() => playSound('hover')}
                className="border border-ash text-ash font-display tracking-widest uppercase text-[10px] px-3 py-1.5 hover:border-ash-bright hover:text-ash-bright transition-colors"
              >
                Open replay
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-grid pb-1 mb-1">
      <span className="text-ash uppercase tracking-wider">{label}</span>
      <span className="text-ash-bright">{value}</span>
    </div>
  );
}
