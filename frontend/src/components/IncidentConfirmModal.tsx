'use client';

import { useEffect, useState } from 'react';
import type { IncidentRecord } from './IncidentsPanel';

// NOTE (honesty flag): Kind/Node fields from the mockup ("Node silence
// (retry exhausted)", "NODE-14") aren't available — INCIDENT_AWAITING_OPERATOR
// only carries { incidentId, tier, rogueAi? }. Shown as "—" rather than
// invented. Detected/elapsed IS real, computed from when this incident was
// first seen client-side.
//
// NOTE (design decision, not just SHATTER anymore): every tier now requires
// a typed command, not just SHATTER — a one-click "Confirm" button defeated
// the point of forcing deliberate input. The ID is still copy-assisted
// (it's a UUID, nobody should have to hand-type that under pressure) but
// the verb always has to be typed. The raw grammar only recognizes
// "CONFIRM SPLICE" or "CONFIRM SHATTER" (see terminal-parser.util.ts on
// the backend) — there's no "CONFIRM LATCH" — so a LATCH-tier incident
// still shows the SPLICE phrasing; that's a backend grammar quirk, not a
// frontend guess.
export function IncidentConfirmModal({
  incident,
  onCopyToTerminal,
  onClose,
}: {
  incident: IncidentRecord;
  onCopyToTerminal: (text: string) => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedMs = now - new Date(incident.createdAt).getTime();
  const elapsed = formatElapsed(elapsedMs);
  const isShatter = incident.tier === 'SHATTER';
  const verb = isShatter ? 'SHATTER' : 'SPLICE';
  const tint = isShatter ? 'border-danger' : incident.tier === 'SPLICE' ? 'border-warn' : 'border-signal';

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

          <div className="bg-void border border-grid p-3 font-mono text-signal">
            The terminal only appends — type the verb first, then use the button below to drop the ID
            in after it.
            <br />
            <span className="bg-white/5 px-1">{`CONFIRM ${verb} //${incident.id}`}</span>
          </div>

          <ol className="text-ash list-decimal list-inside space-y-1">
            <li>
              In the terminal, type <span className="text-signal">{`CONFIRM ${verb} `}</span>(with the trailing
              space)
            </li>
            <li>Click below to append the ID</li>
            <li>Press Enter</li>
          </ol>

          <button
            onClick={() => {
              onCopyToTerminal(`//${incident.id}`);
              setCopied(true);
            }}
            className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] py-2 hover:bg-signal hover:text-void transition-colors"
          >
            Append ID to terminal
          </button>
          {copied && <p className="text-ash">ID appended — press Enter in the terminal to send.</p>}
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
