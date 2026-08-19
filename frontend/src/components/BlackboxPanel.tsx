'use client';

import { useEffect, useState } from 'react';
import { ApiError, CaseFileSummaryDto, kBlackboxApi } from '@/lib/api-client';
import type { IncidentRecord } from './IncidentsPanel';

interface CaseRowData {
  incidentId: string;
  tier?: IncidentRecord['tier'];
  createdAt: string;
  aiSummary?: string | null;
}

// NOTE (honesty flag): GET /k-blackbox/cases doesn't exist yet, so the
// archive falls back to resolved/escalated incidents seen this session
// (real IDs, same socket-driven state IncidentsPanel uses). Summarize and
// Replay ARE real endpoints (KBlackboxController) and work against any
// valid incidentId regardless. The "search similar cases" box from the
// mockup is kept visually but disabled — the real search endpoint takes a
// precomputed embedding vector, not text, and there's no server-side
// "embed this query" step yet, so it has nothing real to call.
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

  useEffect(() => {
    kBlackboxApi
      .listCases(accessToken)
      .then((list) => setRemoteCases(list))
      .catch((err) => {
        setListError(
          err instanceof ApiError && err.status === 404
            ? 'GET /k-blackbox/cases not deployed yet — showing resolved incidents from this session instead.'
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

  const selected = rows.find((r) => r.incidentId === selectedId) ?? rows[0] ?? null;

  async function summarize(incidentId: string) {
    setBusyId(incidentId);
    try {
      const result = await kBlackboxApi.summarize(accessToken, incidentId);
      setSummaries((prev) => ({ ...prev, [incidentId]: result.summary ?? result.skipped ?? 'No summary returned.' }));
    } catch (err) {
      setSummaries((prev) => ({
        ...prev,
        [incidentId]: err instanceof Error ? `Error: ${err.message}` : 'Summarize failed.',
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 h-full text-xs">
      <div className="flex flex-col min-h-0">
        {listError && <p className="text-warn mb-2">{listError}</p>}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows.length === 0 && <p className="text-ash">No resolved cases yet this session.</p>}
          {rows.map((r) => (
            <button
              key={r.incidentId}
              onClick={() => setSelectedId(r.incidentId)}
              className={`w-full text-left px-2 py-2 border-b border-grid hover:bg-grid/30 transition-colors ${
                selected?.incidentId === r.incidentId ? 'bg-signal/5 border-l-2 border-l-signal' : ''
              }`}
            >
              {r.tier ? <span className="mr-2">{r.tier}</span> : null} #{r.incidentId.slice(0, 8)}… —{' '}
              {new Date(r.createdAt).toLocaleDateString()}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mt-3 pt-3 border-t border-dashed border-grid">
          <input
            disabled
            placeholder="Search similar cases… (needs text→embedding endpoint)"
            className="flex-1 bg-void border border-grid px-2 py-1.5 text-ash outline-none opacity-50 cursor-not-allowed"
          />
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
            {selected.tier && <Row label="Tier" value={selected.tier} />}
            <Row label="Incident" value={`#${selected.incidentId.slice(0, 8)}…`} />
            <div className="flex-1 min-h-0 overflow-y-auto text-signal leading-relaxed py-3">
              {summaries[selected.incidentId] ?? selected.aiSummary ?? 'No AI summary yet.'}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => summarize(selected.incidentId)}
                disabled={busyId === selected.incidentId}
                className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 py-1.5 hover:bg-signal hover:text-void transition-colors disabled:opacity-40"
              >
                {busyId === selected.incidentId ? 'Working…' : 'Summarize'}
              </button>
              <button
                onClick={() => onOpenReplay(selected.incidentId)}
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
