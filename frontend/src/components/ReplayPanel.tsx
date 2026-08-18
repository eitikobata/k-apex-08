'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, kBlackboxApi } from '@/lib/api-client';

const STEP_MS = 1200;

// The replay endpoint (GET /k-blackbox/cases/:id/replay) is real and already
// returns the contributing RawEvents for an incident, but typed as unknown[]
// on the frontend on purpose — the backend hands back whatever shape
// KBlackboxService.replayIncident builds today, and locking that down here
// would silently break the moment that shape changes. This renderer reads
// fields defensively (kind/type/createdAt/payload) rather than assuming a
// strict schema.
export function ReplayPanel({ accessToken, incidentId }: { accessToken: string; incidentId: string }) {
  const [events, setEvents] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setEvents(null);
    setError(null);
    setIndex(0);
    setPlaying(false);
    kBlackboxApi
      .replay(accessToken, incidentId)
      .then((list) => setEvents(list))
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? `No case found for incident ${incidentId.slice(0, 8)}… — it may not be archived yet.`
            : err instanceof Error
              ? err.message
              : 'Failed to load replay.',
        );
      });
  }, [accessToken, incidentId]);

  useEffect(() => {
    if (!playing || !events) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => {
        if (i >= events.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, STEP_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, events]);

  if (error) {
    return <div className="p-3 text-xs text-warn">{error}</div>;
  }
  if (!events) {
    return <div className="p-3 text-xs text-ash">Loading replay…</div>;
  }
  if (events.length === 0) {
    return <div className="p-3 text-xs text-ash">This case has no recorded events.</div>;
  }

  const current = events[index];

  return (
    <div className="p-3 h-full flex flex-col gap-3 text-xs">
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 py-1.5 hover:bg-signal hover:text-void transition-colors"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="border border-ash text-ash px-2 py-1.5 hover:border-ash-bright hover:text-ash-bright transition-colors disabled:opacity-30"
        >
          ‹ prev
        </button>
        <button
          onClick={() => setIndex((i) => Math.min(events.length - 1, i + 1))}
          disabled={index === events.length - 1}
          className="border border-ash text-ash px-2 py-1.5 hover:border-ash-bright hover:text-ash-bright transition-colors disabled:opacity-30"
        >
          next ›
        </button>
        <span className="text-ash ml-auto">
          {index + 1} / {events.length}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={events.length - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
        className="w-full accent-signal shrink-0"
      />

      <div className="panel-border bg-panel/60 p-3 flex-1 min-h-0 overflow-y-auto">
        <EventDetail event={current} />
      </div>
    </div>
  );
}

function EventDetail({ event }: { event: unknown }) {
  if (typeof event !== 'object' || event === null) {
    return <pre className="text-ash-bright whitespace-pre-wrap break-words">{String(event)}</pre>;
  }
  const rec = event as Record<string, unknown>;
  const kind = rec.kind ?? rec.type ?? rec.eventType ?? 'EVENT';
  const createdAt = rec.createdAt ?? rec.timestamp;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-display tracking-widest text-danger uppercase">{String(kind)}</span>
        {typeof createdAt === 'string' && (
          <span className="text-ash">{new Date(createdAt).toLocaleString()}</span>
        )}
      </div>
      <pre className="text-ash-bright whitespace-pre-wrap break-words text-[11px]">
        {JSON.stringify(rec, null, 2)}
      </pre>
    </div>
  );
}
