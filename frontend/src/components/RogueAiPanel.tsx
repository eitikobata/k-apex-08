'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { sendNormalizedCommand } from '@/lib/socket-client';

export interface RogueAiActive {
  rogueAiIncidentId: string;
  state: string; // RogueAiState from the backend enum, kept as string here on purpose —
  // ESCALATED/SPREAD terminal states arrive the same way as the happy path
  // and this component doesn't need to distinguish them at the type level.
  deadlineAt: number; // client-side epoch ms — see note below
}

const STEPS = ['DETECTED', 'CONTAINED_STEP_1', 'CONTAINED_STEP_2', 'NEUTRALIZED'] as const;
const TERMINAL_BAD = new Set(['ESCALATED', 'SPREAD']);
const STEP_WINDOW_MS = 15_000;

// NOTE (honesty flag): the 15s-per-step window is a fixed rule from the
// project brief and matches RogueAiIncident.stepDeadlineAt in the backend
// schema, but ROGUE_AI_TRANSITION's socket payload doesn't broadcast the
// actual deadline timestamp — only { rogueAiIncidentId, outcome, nextState }.
// So this countdown is a client-side mirror (reset to 15s on every
// transition), not a server-confirmed remaining time. If K-DIRECTIVE's
// timing logic ever changes, this drifts out of sync until the payload
// carries stepDeadlineAt for real.
export function RogueAiPanel({
  active,
  socket,
}: {
  active: RogueAiActive | null;
  socket: Socket | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [active]);

  if (!active) {
    return (
      <div className="p-3 h-full flex items-center justify-center text-xs text-ash">
        No Rogue AI incident active.
      </div>
    );
  }

  const remainingMs = Math.max(0, active.deadlineAt - now);
  const pct = Math.round((remainingMs / STEP_WINDOW_MS) * 100);
  const isBad = TERMINAL_BAD.has(active.state);
  const currentStepIndex = STEPS.indexOf(active.state as (typeof STEPS)[number]);

  function issue(command: 'ISOLATE' | 'TRACE' | 'PURGE') {
    if (!socket || !active) return;
    sendNormalizedCommand(socket, {
      type: 'ROGUE_AI_COMMAND',
      rogueAiIncidentId: active.rogueAiIncidentId,
      command,
    });
  }

  return (
    <div className="p-3 h-full flex flex-col gap-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-ash">Incident {active.rogueAiIncidentId.slice(0, 8)}…</span>
        <span className={isBad ? 'text-danger font-display tracking-widest' : 'text-warn font-display tracking-widest'}>
          {active.state.replace(/_/g, ' ')}
        </span>
      </div>

      {!isBad && (
        <div className="flex items-center gap-1 shrink-0">
          {STEPS.map((step, i) => (
            <div key={step} className="flex-1 flex items-center gap-1">
              <div
                className={`h-2 flex-1 ${
                  i <= currentStepIndex && currentStepIndex >= 0 ? 'bg-danger' : 'bg-grid'
                }`}
              />
              {i < STEPS.length - 1 && <span className="text-ash text-[10px]">›</span>}
            </div>
          ))}
        </div>
      )}

      {!isBad && active.state !== 'NEUTRALIZED' && (
        <div className="shrink-0">
          <div className="flex justify-between text-[10px] text-ash mb-1">
            <span>Command window</span>
            <span>{(remainingMs / 1000).toFixed(1)}s</span>
          </div>
          <div className="h-2 bg-grid">
            <div
              className={`h-full transition-[width] ${pct < 25 ? 'bg-danger' : pct < 60 ? 'bg-warn' : 'bg-signal'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {!isBad && active.state !== 'NEUTRALIZED' && (
        <div className="flex gap-2">
          <CommandButton label="Isolate" onClick={() => issue('ISOLATE')} />
          <CommandButton label="Trace" onClick={() => issue('TRACE')} />
          <CommandButton label="Purge" onClick={() => issue('PURGE')} />
        </div>
      )}

      {active.state === 'NEUTRALIZED' && (
        <p className="text-signal">Rogue AI neutralized. Case will archive to K-BLACKBOX.</p>
      )}
      {isBad && (
        <p className="text-danger">
          Containment failed ({active.state.toLowerCase()}) — this incident has escalated beyond
          operator-issued commands.
        </p>
      )}
    </div>
  );
}

function CommandButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 border border-danger text-danger font-display tracking-widest uppercase text-[10px] py-2 hover:bg-danger hover:text-void transition-colors"
    >
      {label}
    </button>
  );
}
