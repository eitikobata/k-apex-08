'use client';

import { useEffect, useState } from 'react';
import { ApiError, CaseFileSummaryDto, kBlackboxApi } from '@/lib/api-client';
import type { IncidentRecord } from './IncidentsPanel';

// NOTE (honesty flag): GET /k-blackbox/cases doesn't exist yet, so the case
// archive falls back to incidents already seen this session (real IDs, from
// the same socket-driven state IncidentsPanel uses) plus a manual ID field.
// Summarize and Replay ARE real endpoints (KBlackboxController) — they work
// against any valid incidentId right now, list or no list. Semantic search
// is left out entirely: POST /k-blackbox/cases/search takes a precomputed
// embedding vector, and there's no server-side "turn this text into an
// embedding" step yet, so a text search box would have nothing real to call.
export function BlackboxPanel({
  accessToken,
  sessionIncidents,
  onOpenReplay,
}: {
  accessToken: string;
  sessionIncidents: IncidentRecord[];
  onOpenReplay: (incidentId: string) => void;
}) {
  const [cases, setCases] = useState<CaseFileSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    kBlackboxApi
      .listCases(accessToken)
      .then((list) => setCases(list))
      .catch((err) => {
        setListError(
          err instanceof ApiError && err.status === 404
            ? 'Backend endpoint not deployed yet — this list will populate once GET /k-blackbox/cases exists. Using session incidents below instead.'
            : err instanceof Error
              ? err.message
              : 'Failed to load case archive.',
        );
      });
  }, [accessToken]);

  async function summarize(incidentId: string) {
    setBusyId(incidentId);
    try {
      const result = await kBlackboxApi.summarize(accessToken, incidentId);
      setSummaries((prev) => ({
        ...prev,
        [incidentId]: result.summary ?? result.skipped ?? 'No summary returned.',
      }));
    } catch (err) {
      setSummaries((prev) => ({
        ...prev,
        [incidentId]: err instanceof Error ? `Error: ${err.message}` : 'Summarize failed.',
      }));
    } finally {
      setBusyId(null);
    }
  }

  const fallbackRows = sessionIncidents.filter(
    (i) => i.status === 'RESOLVED' || i.status === 'ESCALATED',
  );

  return (
    <div className="p-3 h-full flex flex-col gap-3 text-xs">
      <div className="flex gap-2 items-end shrink-0">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[10px] text-ash tracking-widest uppercase">
            Open case by incident ID
          </span>
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="incident uuid…"
            className="bg-void panel-border px-2 py-1.5 text-ash-bright outline-none focus:border-signal"
          />
        </label>
        <button
          disabled={!manualId.trim()}
          onClick={() => onOpenReplay(manualId.trim())}
          className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 py-1.5 hover:bg-signal hover:text-void transition-colors disabled:opacity-40"
        >
          Replay
        </button>
      </div>

      {listError && <p className="text-warn shrink-0">{listError}</p>}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {cases && cases.length > 0 && (
          <table className="w-full text-left font-mono mb-3">
            <thead>
              <tr className="border-b border-grid text-ash uppercase tracking-wider">
                <th className="py-1 pr-3">Incident</th>
                <th className="py-1 pr-3">Archived</th>
                <th className="py-1 pr-3">AI summary</th>
                <th className="py-1 pr-3" />
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <CaseRow
                  key={c.id}
                  incidentId={c.incidentId}
                  createdAt={c.createdAt}
                  summary={summaries[c.incidentId] ?? c.aiSummary}
                  busy={busyId === c.incidentId}
                  onSummarize={() => summarize(c.incidentId)}
                  onReplay={() => onOpenReplay(c.incidentId)}
                />
              ))}
            </tbody>
          </table>
        )}

        {(!cases || cases.length === 0) && (
          <>
            <p className="text-ash mb-2">
              {fallbackRows.length > 0
                ? 'Resolved incidents from this session:'
                : 'No resolved incidents yet this session.'}
            </p>
            {fallbackRows.length > 0 && (
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="border-b border-grid text-ash uppercase tracking-wider">
                    <th className="py-1 pr-3">Incident</th>
                    <th className="py-1 pr-3">Updated</th>
                    <th className="py-1 pr-3">AI summary</th>
                    <th className="py-1 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {fallbackRows.map((inc) => (
                    <CaseRow
                      key={inc.id}
                      incidentId={inc.id}
                      createdAt={inc.updatedAt}
                      summary={summaries[inc.id]}
                      busy={busyId === inc.id}
                      onSummarize={() => summarize(inc.id)}
                      onReplay={() => onOpenReplay(inc.id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CaseRow({
  incidentId,
  createdAt,
  summary,
  busy,
  onSummarize,
  onReplay,
}: {
  incidentId: string;
  createdAt: string;
  summary?: string | null;
  busy: boolean;
  onSummarize: () => void;
  onReplay: () => void;
}) {
  return (
    <tr className="border-b border-grid/50 text-ash-bright align-top">
      <td className="py-1.5 pr-3">{incidentId.slice(0, 8)}…</td>
      <td className="py-1.5 pr-3 text-ash">{new Date(createdAt).toLocaleString()}</td>
      <td className="py-1.5 pr-3 max-w-xs text-ash">{summary ?? '—'}</td>
      <td className="py-1.5 pr-3 flex gap-2">
        <button
          onClick={onSummarize}
          disabled={busy}
          className="border border-signal text-signal px-2 py-0.5 hover:bg-signal hover:text-void transition-colors disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Summarize'}
        </button>
        <button
          onClick={onReplay}
          className="border border-ash text-ash px-2 py-0.5 hover:border-ash-bright hover:text-ash-bright transition-colors"
        >
          Replay
        </button>
      </td>
    </tr>
  );
}
