'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth-store';
import { createConsoleSocket, NormalizedCommand } from '@/lib/socket-client';
import { kDirectiveApi, kStreamApi, SystemStateDto } from '@/lib/api-client';
import { Panel } from '@/components/Panel';
import { Blackwall, ThreatLevel } from '@/components/Blackwall';
import { LockdownOverlay } from '@/components/LockdownOverlay';
import { TopBar } from '@/components/TopBar';
import { NotesPanel } from '@/components/NotesPanel';
import { InstructionsPanel } from '@/components/InstructionsPanel';
import { IncidentsPanel, IncidentRecord } from '@/components/IncidentsPanel';
import { NodeGrid } from '@/components/NodeGrid';
import { RogueAiPanel, RogueAiActive } from '@/components/RogueAiPanel';
import { BlackboxPanel } from '@/components/BlackboxPanel';
import { ReplayPanel } from '@/components/ReplayPanel';
import { AuditLogPanel } from '@/components/AuditLogPanel';
import { useThreatStore } from '@/lib/threat-store';
import { BackgroundColumns } from '@/components/BackgroundColumns';

// xterm.js references `self` at module-eval time, which doesn't exist
// during Next's server-side render — must be client-only.
const ConsoleTerminal = dynamic(
  () => import('@/components/ConsoleTerminal').then((mod) => mod.ConsoleTerminal),
  { ssr: false },
);

interface FeedLine {
  id: number;
  text: string;
  tone: 'signal' | 'warn' | 'danger' | 'ash';
}

type ConsoleView = 'OVERVIEW' | 'BLACKBOX' | 'AUDIT';

// Matches STEP_WINDOW_MS in rogue-ai.service.ts on the backend — bumped
// from 15s to 30s, see the honesty flag on RogueAiPanel for why.
const ROGUE_AI_STEP_WINDOW_MS = 30_000;

const DEBUG_INJECT_TYPES = ['LATCH', 'SPLICE', 'SHATTER', 'ROGUE_AI'] as const;

let feedIdCounter = 0;

export default function ConsolePage() {
  const router = useRouter();
  const hydrate = useAuthStore((s) => s.hydrate);
  const session = useAuthStore((s) => s.session);
  const role = useAuthStore((s) => s.role);
  const clearSession = useAuthStore((s) => s.clearSession);

  const [hydrated, setHydrated] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [systemState, setSystemState] = useState<SystemStateDto | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [threatLevel, setThreatLevel] = useState<ThreatLevel>('CALM');
  const [autonomousBusy, setAutonomousBusy] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const feedContainerRef = useRef<HTMLDivElement>(null);
  const threatDecayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [view, setView] = useState<ConsoleView>('OVERVIEW');
  const [notesOpen, setNotesOpen] = useState(false);
  const [replayIncidentId, setReplayIncidentId] = useState<string | null>(null);
  const [terminalInsert, setTerminalInsert] = useState<{ token: number; text: string } | null>(null);
  const [debugBusyType, setDebugBusyType] = useState<(typeof DEBUG_INJECT_TYPES)[number] | null>(null);

  function copyToTerminal(text: string) {
    setTerminalInsert({ token: Date.now(), text });
  }

  // Incident records and Rogue AI state are both derived, client-side, from
  // the same socket events the signal feed already listens to. Session
  // scoped by construction — see honesty flags in IncidentsPanel/RogueAiPanel.
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  // NOTE (bugfix): this used to be a single RogueAiActive | null — with more
  // than one Rogue AI incident active at once (which the simulator can
  // absolutely produce), the second one landing would silently overwrite
  // the first's containment progress, and ROGUE_AI_TRANSITION events for
  // the first would then get misapplied to the second. An array, keyed by
  // rogueAiIncidentId, tracks each independently; the overlay renders one
  // floating panel per active incident, stacked.
  const [rogueAiList, setRogueAiList] = useState<RogueAiActive[]>([]);

  // Mirrors rogueAiList into the shared threat store so BackgroundColumns
  // (mounted in layout.tsx, outside this component's tree) can switch into
  // ALERT mode.
  useEffect(() => {
    useThreatStore.getState().setRogueAiActive(rogueAiList.length > 0);
  }, [rogueAiList]);

  useEffect(() => {
    hydrate();
    setHydrated(true);
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!session) {
      router.replace('/login');
    }
  }, [hydrated, session, router]);

  function pushFeed(text: string, tone: FeedLine['tone'] = 'ash') {
    feedIdCounter += 1;
    setFeed((prev) => [...prev.slice(-49), { id: feedIdCounter, text, tone }]);
  }

  // Always keep the most recent event in view — a live feed that stays
  // scrolled to the top while new lines pile up below is worse than
  // useless, it hides the thing you actually need to see.
  useEffect(() => {
    const el = feedContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  /**
   * Bumps the Blackwall's distortion level and schedules a decay back to
   * CALM if nothing else happens for a while. Only genuinely notable
   * events call this (operator-facing incidents, Rogue AI activity) —
   * routine auto-resolved LATCH noise never touches it, on purpose: the
   * wall should read as "something needs attention", not "the network
   * exists".
   */
  function bumpThreat(level: ThreatLevel, decayMs: number) {
    if (threatDecayRef.current) clearTimeout(threatDecayRef.current);
    setThreatLevel(level);
    threatDecayRef.current = setTimeout(() => setThreatLevel('CALM'), decayMs);
  }

  function upsertIncident(id: string, patch: Partial<IncidentRecord>, seed?: Partial<IncidentRecord>) {
    const nowIso = new Date().toISOString();
    setIncidents((prev) => {
      const existing = prev.find((i) => i.id === id);
      if (existing) {
        return prev.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: nowIso } : i));
      }
      return [
        ...prev,
        {
          id,
          tier: 'LATCH',
          status: 'AWAITING_OPERATOR',
          rogueAi: false,
          createdAt: nowIso,
          updatedAt: nowIso,
          ...seed,
          ...patch,
        },
      ];
    });
  }

  // Establish the WebSocket link once we have a session.
  useEffect(() => {
    if (!session) return;

    const s = createConsoleSocket(session.accessToken);
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => {
      setConnected(true);
      pushFeed('Console link established.', 'signal');
    });
    s.on('disconnect', () => {
      setConnected(false);
      pushFeed('Console link dropped.', 'danger');
    });
    s.on('auth_error', (payload: { message: string }) => {
      pushFeed(`Auth rejected: ${payload.message}`, 'danger');
      clearSession();
      router.replace('/login');
    });

    s.on(
      'INCIDENT_AWAITING_OPERATOR',
      (payload: { incidentId: string; tier: 'LATCH' | 'SPLICE' | 'SHATTER'; rogueAi?: boolean; rogueAiIncidentId?: string }) => {
        pushFeed(`Incident awaiting operator — tier ${payload.tier} — ${payload.incidentId}`, 'warn');
        bumpThreat(payload.rogueAi ? 'ROGUE_AI' : 'ACTIVE', payload.rogueAi ? ROGUE_AI_STEP_WINDOW_MS : 8_000);

        upsertIncident(
          payload.incidentId,
          { status: payload.rogueAi ? 'ROGUE_AI_ACTIVE' : 'AWAITING_OPERATOR' },
          { tier: payload.tier, rogueAi: !!payload.rogueAi, rogueAiIncidentId: payload.rogueAiIncidentId },
        );

        if (payload.rogueAi && payload.rogueAiIncidentId) {
          const rogueAiIncidentId = payload.rogueAiIncidentId;
          setRogueAiList((prev) =>
            prev.some((r) => r.rogueAiIncidentId === rogueAiIncidentId)
              ? prev
              : [...prev, { rogueAiIncidentId, state: 'DETECTED', deadlineAt: Date.now() + ROGUE_AI_STEP_WINDOW_MS }],
          );
        }
      },
    );

    s.on('AUTONOMOUS_MODE_CHANGED', (payload: { active: boolean; origin: string }) => {
      pushFeed(`Autonomous mode ${payload.active ? 'ACTIVATED' : 'DEACTIVATED'} (${payload.origin})`, 'danger');
      void refreshSystemState();
    });

    // A successful CONFIRM_KURO_ICE_ACTION resolves the incident.
    s.on('command_result', (payload: { command: NormalizedCommand; result: Record<string, unknown> }) => {
      if (payload.command.type === 'CONFIRM_KURO_ICE_ACTION') {
        const incidentId = payload.command.incidentId;
        pushFeed(`Incident ${incidentId} confirmed by operator.`, 'signal');
        setIncidents((prev) =>
          prev.map((i) => (i.id === incidentId ? { ...i, status: 'RESOLVED', updatedAt: new Date().toISOString() } : i)),
        );
      }
    });
    // Real backend enforcement now (k-directive.service.ts's
    // sweepExpiredOperatorDeadlines) — a LATCH/SPLICE/SHATTER incident
    // that sat past its operatorDeadlineAt without confirmation becomes
    // ESCALATED, same as an expired Rogue AI step.
    s.on('INCIDENT_ESCALATED', (payload: { incidentId: string; tier: string }) => {
      pushFeed(`Incident ${payload.incidentId} escalated — operator deadline expired.`, 'danger');
      setIncidents((prev) =>
        prev.map((i) => (i.id === payload.incidentId ? { ...i, status: 'ESCALATED', updatedAt: new Date().toISOString() } : i)),
      );
    });
    s.on('command_error', (payload: { message: string }) => {
      pushFeed(`Command failed: ${payload.message}`, 'danger');
    });

    s.on('ROGUE_AI_TRANSITION', (payload: { rogueAiIncidentId: string; outcome: string; nextState: string }) => {
      pushFeed(`Rogue AI transition: ${payload.outcome} -> ${payload.nextState}`, 'danger');

      const terminal = ['NEUTRALIZED', 'ESCALATED', 'SPREAD'].includes(payload.nextState);
      setIncidents((prev) =>
        prev.map((i) => {
          if (i.rogueAiIncidentId !== payload.rogueAiIncidentId) return i;
          if (payload.nextState === 'NEUTRALIZED') return { ...i, status: 'RESOLVED', updatedAt: new Date().toISOString() };
          if (payload.nextState === 'ESCALATED' || payload.nextState === 'SPREAD')
            return { ...i, status: 'ESCALATED', updatedAt: new Date().toISOString() };
          return { ...i, updatedAt: new Date().toISOString() };
        }),
      );

      setRogueAiList((prev) =>
        prev.map((r) =>
          r.rogueAiIncidentId === payload.rogueAiIncidentId
            ? { ...r, state: payload.nextState, deadlineAt: terminal ? r.deadlineAt : Date.now() + ROGUE_AI_STEP_WINDOW_MS }
            : r,
        ),
      );

      if (terminal) {
        // Give the operator a beat to see the final state land before the
        // overlay disappears — instant close would read as a glitch.
        setTimeout(() => {
          setRogueAiList((prev) => prev.filter((r) => r.rogueAiIncidentId !== payload.rogueAiIncidentId));
        }, 4_000);
      }

      setRogueAiList((current) => {
        // Recompute threat level from what's still actually active, rather
        // than assuming this transition is the only thing going on — with
        // multiple Rogue AI incidents, one resolving shouldn't necessarily
        // calm the wall down if another is still mid-fight.
        const stillActive = current.filter((r) => r.rogueAiIncidentId !== payload.rogueAiIncidentId || !terminal);
        if (stillActive.length > 0) {
          bumpThreat('ROGUE_AI', ROGUE_AI_STEP_WINDOW_MS);
        } else if (threatDecayRef.current) {
          clearTimeout(threatDecayRef.current);
          setThreatLevel('CALM');
        }
        return current;
      });
    });
    s.on('ROGUE_AI_RESOLVED_AUTONOMOUSLY', (payload: { rogueAiIncidentId: string }) => {
      pushFeed('Rogue AI resolved autonomously (preemptive node lockdown).', 'danger');
      setRogueAiList((prev) => prev.filter((r) => r.rogueAiIncidentId !== payload.rogueAiIncidentId));
      setIncidents((prev) =>
        prev.map((i) =>
          i.rogueAiIncidentId === payload.rogueAiIncidentId
            ? { ...i, status: 'RESOLVED', updatedAt: new Date().toISOString() }
            : i,
        ),
      );
    });

    s.connect();

    return () => {
      s.disconnect();
      s.removeAllListeners();
      if (threatDecayRef.current) clearTimeout(threatDecayRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function refreshSystemState() {
    if (!session) return;
    try {
      const state = await kDirectiveApi.getAutonomousMode(session.accessToken);
      setSystemState(state);
    } catch {
      pushFeed('Failed to fetch system state.', 'danger');
    }
  }

  useEffect(() => {
    if (session) void refreshSystemState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function sendHeartbeat(silent = false) {
    if (!session) return;
    try {
      await kDirectiveApi.heartbeat(session.accessToken);
      if (!silent) pushFeed('Heartbeat sent.', 'signal');
      void refreshSystemState();
    } catch {
      if (!silent) pushFeed('Heartbeat failed.', 'danger');
    }
  }

  // NOTE (bugfix): heartbeat was manual-only — an open tab wasn't enough to
  // keep the dead man's switch happy, so autonomous mode kicked in almost
  // immediately in practice and every incident got auto-resolved before
  // ever reaching AWAITING_OPERATOR. An open console tab having someone at
  // it is exactly what the heartbeat is meant to represent, so it's sent
  // automatically now. Paused while already in lockdown — a heartbeat
  // landing during an AUTO_TIMEOUT lockout hands control back silently,
  // clearing "Stand down" out from under the operator without them doing
  // anything.
  useEffect(() => {
    if (!session || systemState?.autonomousModeActive) return;
    void sendHeartbeat(true);
    const interval = setInterval(() => void sendHeartbeat(true), 20_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, systemState?.autonomousModeActive]);

  async function toggleAutonomous() {
    if (!session || autonomousBusy) return;
    const nextActive = !systemState?.autonomousModeActive;
    setAutonomousBusy(true);
    try {
      await kDirectiveApi.toggleAutonomousMode(session.accessToken, nextActive);
      pushFeed(`Manually ${nextActive ? 'activated' : 'deactivated'} autonomous mode.`, 'warn');
      void refreshSystemState();
    } catch (err) {
      pushFeed(`Toggle failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'danger');
    } finally {
      setAutonomousBusy(false);
    }
  }

  async function debugInject(type: (typeof DEBUG_INJECT_TYPES)[number]) {
    if (!session || debugBusyType) return;
    setDebugBusyType(type);
    try {
      const result = await kStreamApi.debugInject(session.accessToken, type);
      pushFeed(`[DEBUG] Injected ${type} incident — ${result.incidentId}`, 'warn');
    } catch (err) {
      pushFeed(`[DEBUG] Inject failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'danger');
    } finally {
      setDebugBusyType(null);
    }
  }

  function openCase(incidentId: string) {
    setReplayIncidentId(incidentId);
    setView('BLACKBOX');
  }

  // NOTE (honesty flag): "AI resolves" in IncidentsPanel is still pure
  // flavor — no API call, the real Incident row in the backend stays
  // AWAITING_OPERATOR/whatever it actually is. This only updates local
  // frontend state so the row stops showing as actionable and its timer
  // stops (otherwise a "successful" AI resolve would sit there still
  // ticking down toward ESCALATED, which reads as broken even though
  // it's cosmetic on purpose). If you open this incident in K-BLACKBOX
  // later, the backend's real status may not match what's shown here.
  function handleAiResolved(incidentId: string) {
    setIncidents((prev) =>
      prev.map((i) => (i.id === incidentId ? { ...i, status: 'RESOLVED', updatedAt: new Date().toISOString() } : i)),
    );
  }

  if (!session) return null;

  const isAutonomous = !!systemState?.autonomousModeActive;

  return (
    <>
      {/* Ambient background, not a foreground element — sits at z-index -1
          (same layer as BackgroundColumns in layout.tsx, and rendered after
          it in DOM order so it stacks on top of it, both still behind every
          normal-flow panel). pointer-events-none: it's a mood layer, never
          intercepts a click. */}
      {rogueAiList.length > 0 && (
        <div className="fixed inset-0 z-[-1] pointer-events-none rogue-bg-pulse" aria-hidden="true" />
      )}

      {/* Real blocking lockdown — everything behind stops responding to
          clicks (pointer-events-none on the wrapper below); "Stand down"
          lives inside the overlay itself as the one way out. */}
      {isAutonomous && <LockdownOverlay onStandDown={toggleAutonomous} busy={autonomousBusy} />}

      {/* Rogue AI auto-opens — this is the point of the mechanic, an
          operator shouldn't have to go looking for it. Positioned below the
          top row (not centered over it) so Perimeter Defense stays visible
          — it used to sit right on top of it. No backdrop: floating panels,
          terminal and everything else stays fully interactive underneath.
          One panel per active incident, stacked, so a second Rogue AI
          landing doesn't bury the first one's progress. Not dismissible by
          clicking elsewhere on purpose — each clears itself via
          ROGUE_AI_TRANSITION / ROGUE_AI_RESOLVED_AUTONOMOUSLY above. */}
      {rogueAiList.length > 0 && (
        <div className="fixed top-[300px] left-1/2 -translate-x-1/2 z-[555] w-full max-w-2xl px-3 pointer-events-none flex flex-col gap-3">
          {rogueAiList.map((active) => (
            <div
              key={active.rogueAiIncidentId}
              className="panel-border bg-panel border-2 border-danger shadow-[0_0_50px_rgba(232,63,107,0.5)] pointer-events-auto"
            >
              <div className="border-b-2 border-danger px-3 py-2">
                <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">
                  [ Rogue AI containment ]
                </span>
              </div>
              <div className="p-4">
                <RogueAiPanel active={active} onCopyToTerminal={copyToTerminal} />
              </div>
            </div>
          ))}
        </div>
      )}

      {notesOpen && (
        <div className="fixed inset-0 z-[550] bg-void/80 flex items-center justify-center" onClick={() => setNotesOpen(false)}>
          <div className="panel-border bg-panel w-full max-w-2xl h-[70vh]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b-2 border-danger px-3 py-2 flex items-center justify-between">
              <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">[ Notes — full view ]</span>
              <button onClick={() => setNotesOpen(false)} className="text-ash hover:text-ash-bright text-xs">
                close ✕
              </button>
            </div>
            <NotesPanel />
          </div>
        </div>
      )}

      <div
        className={`relative h-screen w-screen flex flex-col ${isAutonomous ? 'mode-autonomous pointer-events-none' : 'mode-operator'}`}
      >
        {/* Scoped ambient background — see the long note in
            BackgroundColumns.tsx. First child + position:relative parent +
            position:absolute z-0 self, with every panel below rendered
            after it in plain DOM order — guaranteed to paint underneath,
            no cross-page or negative-z-index stacking theory required. */}
        <BackgroundColumns scoped />

        <TopBar
          connected={connected}
          isAutonomous={isAutonomous}
          isAdmin={role === 'ADMIN'}
          accessToken={session.accessToken}
          onOpenNotes={() => setNotesOpen(true)}
        />

        <nav className="relative flex gap-2 px-3 pt-3 shrink-0 text-[10px]">
          {(
            [
              ['OVERVIEW', 'Overview'],
              ['BLACKBOX', 'K-BLACKBOX'],
              ['AUDIT', 'Audit log'],
            ] as [ConsoleView, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`bg-void font-display tracking-widest uppercase px-3 py-1.5 border transition-colors ${
                view === key
                  ? 'border-danger text-danger'
                  : 'border-ash text-ash hover:border-ash-bright hover:text-ash-bright'
              }`}
            >
              {label}
            </button>
          ))}

          {/* Client-side gate only — the endpoint itself is admin-only
              server-side too (RolesGuard), this is purely UX (don't show a
              button a non-admin would get a 403 clicking). */}
          {role === 'ADMIN' && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-ash text-[9px] tracking-widest uppercase mr-1">Force incident:</span>
              {DEBUG_INJECT_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => void debugInject(type)}
                  disabled={debugBusyType !== null}
                  className="bg-void border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[9px] px-2 py-1 transition-colors disabled:opacity-40"
                >
                  {debugBusyType === type ? '…' : type.replace('_', ' ')}
                </button>
              ))}
            </div>
          )}
        </nav>

        <main className="relative flex-1 min-h-0 p-8 overflow-y-auto">
          {view === 'OVERVIEW' && (
            <div className="min-h-full flex flex-col gap-5">
              <div className="grid grid-cols-[260px_1fr_300px_260px] gap-5 h-56 shrink-0">
                <Panel title="System state">
                  <div className="p-3 flex flex-col gap-3 text-xs">
                    <Row label="Autonomous mode" value={isAutonomous ? 'ACTIVE' : 'STANDBY'} />
                    <Row label="Origin" value={systemState?.activatedOrigin ?? '—'} />
                    <button
                      onClick={() => sendHeartbeat()}
                      className="mt-2 border border-signal text-signal font-display tracking-widest uppercase text-[10px] py-1.5 hover:bg-signal hover:text-void transition-colors"
                    >
                      Send heartbeat
                    </button>
                    <button
                      onClick={toggleAutonomous}
                      disabled={autonomousBusy}
                      className="border border-warn text-warn font-display tracking-widest uppercase text-[10px] py-1.5 hover:bg-warn hover:text-void transition-colors disabled:opacity-50"
                    >
                      {autonomousBusy ? 'Working…' : isAutonomous ? 'Stand down' : 'Go autonomous'}
                    </button>
                  </div>
                </Panel>

                <Panel title="Perimeter defense">
                  <Blackwall threatLevel={threatLevel} />
                </Panel>

                <Panel title="Signal feed">
                  <div
                    ref={feedContainerRef}
                    className="p-3 flex flex-col gap-1 text-xs overflow-y-auto h-full font-mono"
                  >
                    {feed.length === 0 && <span className="text-ash">Awaiting signal…</span>}
                    {feed.map((line) => (
                      <span key={line.id} className={toneClass(line.tone)}>
                        {line.text}
                      </span>
                    ))}
                  </div>
                </Panel>

                <Panel title="Instructions">
                  <InstructionsPanel />
                </Panel>
              </div>

              <div className="grid grid-cols-[260px_1fr_300px_260px] gap-5 h-64 shrink-0">
                <div className="col-span-2 min-h-0">
                  <Panel title="Incidents" className="h-full">
                    <div className="h-full flex flex-col p-3">
                      <IncidentsPanel incidents={incidents} onCopyToTerminal={copyToTerminal} onOpenCase={openCase} onAiResolved={handleAiResolved} />
                    </div>
                  </Panel>
                </div>
                <div className="col-span-2 min-h-0">
                  <Panel title="K-SILENCE — node status" className="h-full">
                    <div className="p-3 h-full">
                      <NodeGrid accessToken={session.accessToken} />
                    </div>
                  </Panel>
                </div>
              </div>

              <Panel title="Command terminal" className="h-72 shrink-0">
                <ConsoleTerminal socket={socket} insertRequest={terminalInsert} />
              </Panel>
            </div>
          )}

          {view === 'BLACKBOX' && (
            <Panel title="K-BLACKBOX — case archive" className="h-full">
              <div className="p-3 h-full">
                <BlackboxPanel
                  accessToken={session.accessToken}
                  sessionIncidents={incidents}
                  onOpenReplay={setReplayIncidentId}
                />
              </div>
              {replayIncidentId && (
                <div className="fixed inset-0 z-[540] bg-void/85 flex items-center justify-center" onClick={() => setReplayIncidentId(null)}>
                  <div className="panel-border bg-panel w-full max-w-3xl h-[75vh]" onClick={(e) => e.stopPropagation()}>
                    <div className="border-b-2 border-danger px-3 py-2 flex items-center justify-between">
                      <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">
                        [ Replay — {replayIncidentId.slice(0, 8)}… ]
                      </span>
                      <button onClick={() => setReplayIncidentId(null)} className="text-ash hover:text-ash-bright text-xs">
                        close ✕
                      </button>
                    </div>
                    <div className="p-4 h-[calc(100%-40px)]">
                      <ReplayPanel accessToken={session.accessToken} incidentId={replayIncidentId} />
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          )}

          {view === 'AUDIT' && (
            <Panel title="K-BLACKTAPE — audit log" className="h-full">
              <div className="p-3 h-full">
                <AuditLogPanel accessToken={session.accessToken} />
              </div>
            </Panel>
          )}
        </main>
      </div>
    </>
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

function toneClass(tone: FeedLine['tone']): string {
  switch (tone) {
    case 'signal':
      return 'text-signal';
    case 'warn':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    default:
      return 'text-ash';
  }
}
