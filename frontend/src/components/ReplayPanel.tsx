'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, kBlackboxApi } from '@/lib/api-client';

const BASE_STEP_MS = 1500;
const SPEEDS = [0.5, 1, 2] as const;

// The replay endpoint (GET /k-blackbox/cases/:id/replay) is real and already
// returns the contributing RawEvents for an incident, typed as unknown[] on
// purpose — the backend hands back whatever shape KBlackboxService.
// replayIncident builds today, and locking that down here would silently
// break the moment that shape changes. Fields are read defensively
// (kind/type/createdAt/payload) rather than assuming a strict schema.
export function ReplayPanel({ accessToken, incidentId }: { accessToken: string; incidentId: string }) {
  const [events, setEvents] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

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
    }, BASE_STEP_MS / speed);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, events, speed]);

  if (error) return <div className="text-xs text-warn">{error}</div>;
  if (!events) return <div className="text-xs text-ash">Loading replay…</div>;
  if (events.length === 0) return <div className="text-xs text-ash">This case has no recorded events.</div>;

  const pct = events.length > 1 ? (index / (events.length - 1)) * 100 : 100;

  function seekFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track || !events) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setPlaying(false);
    setIndex(Math.round(ratio * (events.length - 1)));
  }

  return (
    <div className="flex flex-col gap-4 text-xs h-full">
      <div
        ref={trackRef}
        onClick={(e) => seekFromClientX(e.clientX)}
        className="relative h-1.5 bg-grid mx-1 my-6 cursor-pointer shrink-0"
      >
        <div className="absolute left-0 top-0 h-full bg-signal" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 w-3 h-3 rounded-full bg-panel border-2 border-signal -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 py-1.5 hover:bg-signal hover:text-void transition-colors"
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`border font-display text-[10px] px-2.5 py-1.5 tracking-widest transition-colors ${
              speed === s ? 'border-signal text-signal' : 'border-ash text-ash hover:border-ash-bright hover:text-ash-bright'
            }`}
          >
            {s}x
          </button>
        ))}
        <span className="text-ash ml-auto">
          {index + 1} / {events.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
        {events.map((ev, i) => (
          <EventRow key={i} event={ev} active={i === index} onClick={() => { setPlaying(false); setIndex(i); }} />
        ))}
      </div>
    </div>
  );
}

function EventRow({ event, active, onClick }: { event: unknown; active: boolean; onClick: () => void }) {
  const rec = typeof event === 'object' && event !== null ? (event as Record<string, unknown>) : {};
  const kind = rec.kind ?? rec.type ?? rec.eventType ?? 'EVENT';
  const createdAt = rec.createdAt ?? rec.timestamp;

  return (
    <button
      onClick={onClick}
      className={`text-left px-2 py-1.5 border-l-2 transition-colors ${
        active ? 'border-signal text-signal bg-signal/5' : 'border-grid text-ash hover:text-ash-bright'
      }`}
    >
      {typeof createdAt === 'string' && (
        <span className="mr-2">{new Date(createdAt).toLocaleTimeString()} —</span>
      )}
      {String(kind)}
    </button>
  );
}
