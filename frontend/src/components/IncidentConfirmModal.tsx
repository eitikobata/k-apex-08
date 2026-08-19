'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { sendNormalizedCommand } from '@/lib/socket-client';
import type { IncidentRecord } from './IncidentsPanel';

// NOTE (honesty flag): Kind/Node fields from the mockup ("Node silence
// (retry exhausted)", "NODE-14") aren't available — INCIDENT_AWAITING_OPERATOR
// only carries { incidentId, tier, rogueAi? }. Shown as "—" rather than
// invented. Detected/elapsed IS real, computed from when this incident was
// first seen client-side.
export function IncidentConfirmModal({
  incident,
  socket,
  onClose,
}: {
  incident: IncidentRecord;
  socket: Socket | null;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedMs = now - new Date(incident.createdAt).getTime();
  const elapsed = formatElapsed(elapsedMs);
  const isShatter = incident.tier === 'SHATTER';
  const tint = isShatter ? 'border-danger' : incident.tier === 'SPLICE' ? 'border-warn' : 'border-signal';

  function confirm() {
    if (!socket) return;
    sendNormalizedCommand(socket, { type: 'CONFIRM_KURO_ICE_ACTION', incidentId: incident.id });
    setSent(true);
  }

  return (
    <div className="fixed inset-0 z-[560] bg-void/80 flex items-center justify-center" onClick={onClose}>
      <div className={`panel-border bg-panel w-full max-w-lg border-2 ${tint}`} onClick={(e) => e.stopPropagation()}>
        <div className={`border-b-2 px-3 py-2 flex items-center justify-between ${tint}`}>
          <span className="font-display text-xs tracking-[0.2em] uppercase text-ash-bright">
            [ Incident #{incident.id.slice(0, 8)}… — {incident.tier} ]
          </span>
          <button onClick={onClose} className="text-ash hover:text-ash-bright text-xs">
            close ✕
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs">
          <Row label="Kind" value="—" />
          <Row label="Node" value="—" />
          <Row label="Detected" value={`${elapsed} ago`} />
          <Row label="Status" value={incident.status.replace(/_/g, ' ')} />

          {sent && <p className="text-signal">Command sent — check the terminal / signal feed for confirmation.</p>}

          {!sent && !isShatter && (
            <button
              onClick={confirm}
              disabled={!socket}
              className="border border-warn text-warn font-display tracking-widest uppercase text-[10px] py-2 hover:bg-warn hover:text-void transition-colors disabled:opacity-40"
            >
              Confirm {incident.tier} response
            </button>
          )}

          {!sent && isShatter && (
            <div className="bg-void border border-grid p-3 font-mono text-signal">
              High-severity confirmation requires a typed command — no button.
              <br />
              Type in the terminal:{' '}
              <span className="bg-white/5 px-1">{`CONFIRM SHATTER //${incident.id}`}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-grid pb-1">
      <span className="text-ash uppercase tracking-wider">{label}</span>
      <span className="text-ash-bright">{value}</span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
