'use client';

import { useEffect, useState } from 'react';

export interface RogueAiActive {
  rogueAiIncidentId: string;
  state: string; // RogueAiState from the backend enum, kept as string on purpose —
  // ESCALATED/SPREAD terminal states arrive the same way as the happy path
  // and this component doesn't need to distinguish them at the type level.
  deadlineAt: number; // client-side epoch ms — see note below
}

const STEPS = ['DETECTED', 'CONTAINED_STEP_1', 'CONTAINED_STEP_2', 'NEUTRALIZED'] as const;
const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  DETECTED: 'Detected',
  CONTAINED_STEP_1: 'Isolate',
  CONTAINED_STEP_2: 'Trace',
  NEUTRALIZED: 'Purge',
};
const TERMINAL_BAD = new Set(['ESCALATED', 'SPREAD']);
const STEP_WINDOW_MS = 15_000;

// NOTE (honesty flag): the 15s-per-step window is a fixed rule from the
// project brief and matches RogueAiIncident.stepDeadlineAt in the backend
// schema, but ROGUE_AI_TRANSITION's socket payload doesn't broadcast the
// actual deadline — only { rogueAiIncidentId, outcome, nextState }. This
// countdown is a client-side mirror (reset to 15s on every transition), not
// a server-confirmed remaining time.
//
// NOTE (design decision): this used to have one-click ISOLATE/TRACE/PURGE
// buttons that issued the command directly over the socket. Removed on
// purpose — the whole point of "boss-fight, has to be typed" is that a
// button defeats it. The ID is still copy-assisted (nobody should have to
// hand-type a UUID against a 15s clock) but the verb always has to be
// typed in the terminal.
export function RogueAiPanel({
  active,
  onCopyToTerminal,
}: {
  active: RogueAiActive;
  onCopyToTerminal: (text: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = Math.max(0, active.deadlineAt - now);
  const pct = Math.round((remainingMs / STEP_WINDOW_MS) * 100);
  const isBad = TERMINAL_BAD.has(active.state);
  const currentStepIndex = STEPS.indexOf(active.state as (typeof STEPS)[number]);
  const nextCommand: 'ISOLATE' | 'TRACE' | 'PURGE' | null =
    active.state === 'DETECTED'
      ? 'ISOLATE'
      : active.state === 'CONTAINED_STEP_1'
        ? 'TRACE'
        : active.state === 'CONTAINED_STEP_2'
          ? 'PURGE'
          : null;

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-ash">Incident {active.rogueAiIncidentId.slice(0, 8)}…</span>
        <span className={isBad ? 'text-danger font-display tracking-widest' : 'text-warn font-display tracking-widest'}>
          {active.state.replace(/_/g, ' ')}
        </span>
      </div>

      {!isBad && (
        <div className="flex items-center gap-0">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center flex-1">
              <div
                className={`flex-1 text-center py-2 px-1 border font-display text-[10px] tracking-widest uppercase ${
                  i < currentStepIndex || active.state === 'NEUTRALIZED'
                    ? 'border-signal text-signal'
                    : i === currentStepIndex
                      ? 'border-danger text-danger bg-danger/10'
                      : 'border-grid text-ash'
                }`}
              >
                {STEP_LABELS[step]}
              </div>
              {i < STEPS.length - 1 && <span className="text-grid text-sm px-1">›</span>}
            </div>
          ))}
        </div>
      )}

      {!isBad && nextCommand && (
        <>
          <div className="bg-void border border-grid p-2.5 font-mono text-signal">
            Type the verb first, then append the ID:
            <br />
            <span className="bg-white/5 px-1">{`${nextCommand} //${active.rogueAiIncidentId}`}</span>
          </div>
          <button
            onClick={() => onCopyToTerminal(`//${active.rogueAiIncidentId}`)}
            className="border border-danger text-danger font-display tracking-widest uppercase text-[10px] py-2 hover:bg-danger hover:text-void transition-colors"
          >
            Append ID to terminal
          </button>
        </>
      )}

      {!isBad && active.state !== 'NEUTRALIZED' && (
        <div>
          <div className="h-2.5 bg-grid mb-1">
            <div
              className={`h-full transition-[width] ${pct < 25 ? 'bg-danger' : pct < 60 ? 'bg-warn' : 'bg-signal'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[10px] text-ash text-right">{(remainingMs / 1000).toFixed(1)}s remaining on this step</div>
        </div>
      )}

      {active.state === 'NEUTRALIZED' && (
        <p className="text-signal">Rogue AI neutralized. Case will archive to K-BLACKBOX.</p>
      )}
      {isBad && (
        <p className="text-danger">
          Containment failed ({active.state.toLowerCase()}) — this incident escalated beyond operator-issued
          commands.
        </p>
      )}
    </div>
  );
}
