'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth-store';
import { createConsoleSocket } from '@/lib/socket-client';
import { kDirectiveApi, SystemStateDto } from '@/lib/api-client';
import { Panel } from '@/components/Panel';
import { Blackwall, ThreatLevel } from '@/components/Blackwall';
import { AutonomousBanner } from '@/components/AutonomousBanner';
import { AccountMenu } from '@/components/AccountMenu';
import { NotesPanel } from '@/components/NotesPanel';
import { IncidentsPanel, IncidentRecord } from '@/components/IncidentsPanel';
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

type ConsoleView = 'OVERVIEW' | 'INCIDENTS' | 'NODES' | 'ROGUE_AI' | 'BLACKBOX' | 'AUDIT';

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

  // Incident records and Rogue AI state are both derived, client-side, from
  // the same socket events the signal feed already listens to (see the
  // socket effect below). Session-scoped by construction — see the honesty
  // flags in IncidentsPanel/RogueAiPanel for what would make this durable.
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
      (payload: { incidentId: string; tier: string; rogueAi?: boolean; rogueAiIncidentId?: string }) => {
        pushFeed(`Incident awaiting operator — tier ${payload.tier} — ${payload.incidentId}`, 'warn');
        bumpThreat(payload.rogueAi ? 'ROGUE_AI' : 'ACTIVE', payload.rogueAi ? 15_000 : 8_000);

        upsertIncident(
          payload.incidentId,
          { status: payload.rogueAi ? 'ROGUE_AI_ACTIVE' : 'AWAITING_OPERATOR' },
          { tier: payload.tier as IncidentRecord['tier'], rogueAi: !!payload.rogueAi },
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
          ? {
              ...prev,
              state: payload.nextState,
              deadlineAt: terminal ? prev.deadlineAt : Date.now() + 15_000,
            }
          : prev,
      );

      if (payload.outcome === 'NEUTRALIZED' || terminal) {
        if (threatDecayRef.current) clearTimeout(threatDecayRef.current);
        setThreatLevel('CALM');
        if (payload.nextState !== 'NEUTRALIZED') {
          // Escalated/spread — clear the panel after a beat so the operator
          // still sees the final state land before it disappears.
          setTimeout(() => setRogueAiActive(null), 4_000);
        }
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

  function openCase(incidentId: string) {
    setReplayIncidentId(incidentId);
    setView('BLACKBOX');
  }

  return (
    <>
      <AutonomousBanner active={isAutonomous} />

      {notesOpen && (
        <div className="fixed inset-0 z-[550] bg-void/80 flex items-center justify-center" onClick={() => setNotesOpen(false)}>
          <div className="panel-border bg-panel w-full max-w-2xl h-[70vh]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b-2 border-danger px-3 py-2 flex items-center justify-between">
              <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">[ Notes ]</span>
              <button onClick={() => setNotesOpen(false)} className="text-ash hover:text-ash-bright text-xs">
                close ✕
              </button>
            </div>
            <NotesPanel />
          </div>
        </div>
      )}

      <main
        className={`h-screen w-screen p-3 flex flex-col gap-3 ${isAutonomous ? 'mode-autonomous' : 'mode-operator'}`}
      >
        <header className="flex items-center justify-between shrink-0">
          <h1 className="font-display text-sm tracking-[0.3em] text-ash-bright uppercase">
            K-APEX-08 <span className="text-ash">{'//'} Kobata Matrix Corporation</span>
          </h1>
          <div className="flex items-center gap-3 text-xs">
            <span className={connected ? 'text-signal' : 'text-danger'}>
              {connected ? '● LINK UP' : '○ LINK DOWN'}
            </span>
            {isAutonomous && (
              <span className="text-warn font-display tracking-widest">AUTONOMOUS MODE ACTIVE</span>
            )}
            <button
              onClick={() => setNotesOpen(true)}
              className="border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2 py-1 transition-colors"
            >
              Notes
            </button>
            {role === 'ADMIN' && (
              <a
                href="/admin"
                className="border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2 py-1 transition-colors"
              >
                Admin panel
              </a>
            )}
            <AccountMenu accessToken={session.accessToken} />
          </div>
        </header>

        <nav className="flex gap-2 shrink-0 text-[10px]">
          {(
            [
              ['OVERVIEW', 'Overview'],
              ['INCIDENTS', 'Incidents'],
              ['NODES', 'K-SILENCE'],
              ['ROGUE_AI', 'Rogue AI'],
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
              {key === 'ROGUE_AI' && rogueAiActive && <span className="ml-1 text-danger">●</span>}
            </button>
          ))}
        </nav>

        {view === 'OVERVIEW' && (
          <div className="flex-1 min-h-0 grid grid-cols-3 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
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

            <Panel title="Command terminal" className="col-span-3">
              <ConsoleTerminal socket={socket} />
            </Panel>
          </div>
        )}

        {view === 'INCIDENTS' && (
          <Panel title="Incidents" className="flex-1 min-h-0">
            <IncidentsPanel incidents={incidents} onOpenCase={openCase} />
          </Panel>
        )}

        {view === 'NODES' && (
          <Panel title="K-SILENCE — node grid" className="flex-1 min-h-0">
            <NodeGrid accessToken={session.accessToken} />
          </Panel>
        )}

        {view === 'ROGUE_AI' && (
          <Panel title="Rogue AI containment" className="flex-1 min-h-0">
            <RogueAiPanel active={rogueAiActive} socket={socket} />
          </Panel>
        )}

        {view === 'BLACKBOX' && (
          <div className="flex-1 min-h-0 grid grid-cols-2 gap-3">
            <Panel title="K-BLACKBOX — case archive">
              <BlackboxPanel
                accessToken={session.accessToken}
                sessionIncidents={incidents}
                onOpenReplay={setReplayIncidentId}
              />
            </Panel>
            <Panel title={replayIncidentId ? `Replay — ${replayIncidentId.slice(0, 8)}…` : 'Replay'}>
              {replayIncidentId ? (
                <ReplayPanel accessToken={session.accessToken} incidentId={replayIncidentId} />
              ) : (
                <div className="p-3 text-xs text-ash">Select a case to replay it event by event.</div>
              )}
            </Panel>
          </div>
        )}

        {view === 'AUDIT' && (
          <Panel title="K-BLACKTAPE — audit log" className="flex-1 min-h-0">
            <AuditLogPanel accessToken={session.accessToken} />
          </Panel>
        )}
      </main>
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
