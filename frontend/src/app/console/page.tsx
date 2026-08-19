'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth-store';
import { createConsoleSocket, NormalizedCommand } from '@/lib/socket-client';
import { kDirectiveApi, SystemStateDto } from '@/lib/api-client';
import { Panel } from '@/components/Panel';
import { Blackwall, ThreatLevel } from '@/components/Blackwall';
import { LockdownOverlay } from '@/components/LockdownOverlay';
import { TopBar } from '@/components/TopBar';
import { NotesPanel } from '@/components/NotesPanel';
import { IncidentsPanel, IncidentRecord } from '@/components/IncidentsPanel';
import { IncidentConfirmModal } from '@/components/IncidentConfirmModal';
import { NodeGrid } from '@/components/NodeGrid';
import { RogueAiPanel, RogueAiActive } from '@/components/RogueAiPanel';
import { BlackboxPanel } from '@/components/BlackboxPanel';
import { ReplayPanel } from '@/components/ReplayPanel';
import { AuditLogPanel } from '@/components/AuditLogPanel';

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

// Alarm fatigue needs at least this many consecutive, unconfirmed LATCH
// incidents before new ones get pushed to the deprioritized tray. See the
// honesty flag on IncidentRecord — this is a per-tier client heuristic,
// not the per-node mechanic described in the brief, because the node
// identity isn't on the wire yet.
const FATIGUE_THRESHOLD = 3;

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
  const latchStreakRef = useRef(0);

  const [view, setView] = useState<ConsoleView>('OVERVIEW');
  const [notesOpen, setNotesOpen] = useState(false);
  const [replayIncidentId, setReplayIncidentId] = useState<string | null>(null);
  const [confirmIncident, setConfirmIncident] = useState<IncidentRecord | null>(null);

  // Incident records and Rogue AI state are both derived, client-side, from
  // the same socket events the signal feed already listens to. Session
  // scoped by construction — see honesty flags in IncidentsPanel/RogueAiPanel.
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [rogueAiActive, setRogueAiActive] = useState<RogueAiActive | null>(null);

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
        bumpThreat(payload.rogueAi ? 'ROGUE_AI' : 'ACTIVE', payload.rogueAi ? 15_000 : 8_000);

        // Alarm fatigue heuristic — see FATIGUE_THRESHOLD above.
        let deprioritized = false;
        if (payload.tier === 'LATCH' && !payload.rogueAi) {
          latchStreakRef.current += 1;
          deprioritized = latchStreakRef.current > FATIGUE_THRESHOLD;
        }

        upsertIncident(
          payload.incidentId,
          { status: payload.rogueAi ? 'ROGUE_AI_ACTIVE' : 'AWAITING_OPERATOR', deprioritized },
          { tier: payload.tier, rogueAi: !!payload.rogueAi },
        );

        if (payload.rogueAi && payload.rogueAiIncidentId) {
          setRogueAiActive({
            rogueAiIncidentId: payload.rogueAiIncidentId,
            state: 'DETECTED',
            deadlineAt: Date.now() + 15_000,
          });
        }
      },
    );

    s.on('AUTONOMOUS_MODE_CHANGED', (payload: { active: boolean; origin: string }) => {
      pushFeed(`Autonomous mode ${payload.active ? 'ACTIVATED' : 'DEACTIVATED'} (${payload.origin})`, 'danger');
      void refreshSystemState();
    });

    // Closes the loop the confirm modal opens: a successful
    // CONFIRM_KURO_ICE_ACTION resolves the incident and, for LATCH, resets
    // the alarm-fatigue streak (the operator paid attention).
    s.on('command_result', (payload: { command: NormalizedCommand; result: Record<string, unknown> }) => {
      if (payload.command.type === 'CONFIRM_KURO_ICE_ACTION') {
        const incidentId = payload.command.incidentId;
        pushFeed(`Incident ${incidentId} confirmed by operator.`, 'signal');
        setIncidents((prev) =>
          prev.map((i) => (i.id === incidentId ? { ...i, status: 'RESOLVED', updatedAt: new Date().toISOString() } : i)),
        );
        setConfirmIncident((prev) => (prev?.id === incidentId ? null : prev));
        setIncidents((prev) => {
          const resolved = prev.find((i) => i.id === incidentId);
          if (resolved?.tier === 'LATCH') latchStreakRef.current = 0;
          return prev;
        });
      }
    });
    s.on('command_error', (payload: { message: string }) => {
      pushFeed(`Command failed: ${payload.message}`, 'danger');
    });

    s.on('ROGUE_AI_TRANSITION', (payload: { rogueAiIncidentId: string; outcome: string; nextState: string }) => {
      pushFeed(`Rogue AI transition: ${payload.outcome} -> ${payload.nextState}`, 'danger');

      const terminal = ['NEUTRALIZED', 'ESCALATED', 'SPREAD'].includes(payload.nextState);
      setIncidents((prev) =>
        prev.map((i) => {
          // We don't get incidentId on this event, only rogueAiIncidentId —
          // match against whatever incident currently owns the active
          // Rogue AI thread rather than trying to correlate IDs that
          // aren't in the payload.
          if (!i.rogueAi || i.status !== 'ROGUE_AI_ACTIVE') return i;
          if (payload.nextState === 'NEUTRALIZED') return { ...i, status: 'RESOLVED', updatedAt: new Date().toISOString() };
          if (payload.nextState === 'ESCALATED' || payload.nextState === 'SPREAD')
            return { ...i, status: 'ESCALATED', updatedAt: new Date().toISOString() };
          return { ...i, updatedAt: new Date().toISOString() };
        }),
      );

      setRogueAiActive((prev) =>
        prev
          ? { ...prev, state: payload.nextState, deadlineAt: terminal ? prev.deadlineAt : Date.now() + 15_000 }
          : prev,
      );

      if (payload.outcome === 'NEUTRALIZED' || terminal) {
        if (threatDecayRef.current) clearTimeout(threatDecayRef.current);
        setThreatLevel('CALM');
        // Give the operator a beat to see the final state land before the
        // overlay disappears — instant close would read as a glitch.
        setTimeout(() => setRogueAiActive(null), 4_000);
      } else {
        bumpThreat('ROGUE_AI', 15_000);
      }
    });
    s.on('ROGUE_AI_RESOLVED_AUTONOMOUSLY', () => {
      pushFeed('Rogue AI resolved autonomously (preemptive node lockdown).', 'danger');
      if (threatDecayRef.current) clearTimeout(threatDecayRef.current);
      setThreatLevel('CALM');
      setRogueAiActive(null);
      setIncidents((prev) =>
        prev.map((i) =>
          i.rogueAi && i.status === 'ROGUE_AI_ACTIVE'
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

  async function sendHeartbeat() {
    if (!session) return;
    try {
      await kDirectiveApi.heartbeat(session.accessToken);
      pushFeed('Heartbeat sent.', 'signal');
      void refreshSystemState();
    } catch {
      pushFeed('Heartbeat failed.', 'danger');
    }
  }

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

  if (!session) return null;

  const isAutonomous = !!systemState?.autonomousModeActive;

  function handleIncidentRowClick(incident: IncidentRecord) {
    if (incident.status === 'AWAITING_OPERATOR') {
      setConfirmIncident(incident);
    } else if (incident.status === 'RESOLVED' || incident.status === 'ESCALATED') {
      setReplayIncidentId(incident.id);
      setView('BLACKBOX');
    }
    // ROGUE_AI_ACTIVE rows: already surfaced via the auto-opening overlay below.
  }

  return (
    <>
      {/* Real blocking lockdown — everything behind stops responding to
          clicks (pointer-events-none on the wrapper below); "Stand down"
          lives inside the overlay itself as the one way out. */}
      {isAutonomous && <LockdownOverlay onStandDown={toggleAutonomous} busy={autonomousBusy} />}

      {/* Rogue AI auto-opens — this is the point of the mechanic, an
          operator shouldn't have to go looking for it. Not dismissible by
          backdrop click on purpose; it clears itself via ROGUE_AI_TRANSITION /
          ROGUE_AI_RESOLVED_AUTONOMOUSLY (see the socket effect above). */}
      {rogueAiActive && (
        <div className="fixed inset-0 z-[555] bg-void/85 flex items-center justify-center">
          <div className="panel-border bg-panel w-full max-w-2xl border-2 border-danger">
            <div className="border-b-2 border-danger px-3 py-2">
              <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">
                [ Rogue AI containment ]
              </span>
            </div>
            <div className="p-4">
              <RogueAiPanel active={rogueAiActive} socket={socket} />
            </div>
          </div>
        </div>
      )}

      {confirmIncident && (
        <IncidentConfirmModal
          incident={confirmIncident}
          socket={socket}
          onClose={() => setConfirmIncident(null)}
        />
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
        className={`h-screen w-screen flex flex-col ${isAutonomous ? 'mode-autonomous pointer-events-none' : 'mode-operator'}`}
      >
        <TopBar
          connected={connected}
          isAutonomous={isAutonomous}
          isAdmin={role === 'ADMIN'}
          accessToken={session.accessToken}
          onOpenNotes={() => setNotesOpen(true)}
        />

        <nav className="flex gap-2 px-3 pt-3 shrink-0 text-[10px]">
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
              className={`font-display tracking-widest uppercase px-3 py-1.5 border transition-colors ${
                view === key
                  ? 'border-danger text-danger'
                  : 'border-ash text-ash hover:border-ash-bright hover:text-ash-bright'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-h-0 p-3">
          {view === 'OVERVIEW' && (
            <div className="h-full flex flex-col gap-3">
              <div className="grid grid-cols-[260px_1fr_300px_260px] gap-3 h-64 shrink-0">
                <Panel title="System state">
                  <div className="p-3 flex flex-col gap-3 text-xs">
                    <Row label="Autonomous mode" value={isAutonomous ? 'ACTIVE' : 'STANDBY'} />
                    <Row label="Origin" value={systemState?.activatedOrigin ?? '—'} />
                    <button
                      onClick={sendHeartbeat}
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

                <Panel title="Notes">
                  <NotesPanel />
                </Panel>
              </div>

              <div className="grid grid-cols-[260px_1fr_300px_260px] gap-3 flex-1 min-h-0">
                <div className="col-span-2 min-h-0">
                  <Panel title="Incidents" className="h-full">
                    <div className="p-3 h-full">
                      <IncidentsPanel incidents={incidents} onRowClick={handleIncidentRowClick} />
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

              <Panel title="Command terminal" className="h-40 shrink-0">
                <ConsoleTerminal socket={socket} />
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
