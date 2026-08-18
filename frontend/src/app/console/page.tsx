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
      (payload: { incidentId: string; tier: string; rogueAi?: boolean }) => {
        pushFeed(`Incident awaiting operator — tier ${payload.tier} — ${payload.incidentId}`, 'warn');
        bumpThreat(payload.rogueAi ? 'ROGUE_AI' : 'ACTIVE', payload.rogueAi ? 15_000 : 8_000);
      },
    );
    s.on('AUTONOMOUS_MODE_CHANGED', (payload: { active: boolean; origin: string }) => {
      pushFeed(`Autonomous mode ${payload.active ? 'ACTIVATED' : 'DEACTIVATED'} (${payload.origin})`, 'danger');
      void refreshSystemState();
    });
    s.on('ROGUE_AI_TRANSITION', (payload: { outcome: string; nextState: string }) => {
      pushFeed(`Rogue AI transition: ${payload.outcome} -> ${payload.nextState}`, 'danger');
      if (payload.outcome === 'NEUTRALIZED') {
        if (threatDecayRef.current) clearTimeout(threatDecayRef.current);
        setThreatLevel('CALM');
      } else {
        bumpThreat('ROGUE_AI', 15_000);
      }
    });
    s.on('ROGUE_AI_RESOLVED_AUTONOMOUSLY', () => {
      pushFeed('Rogue AI resolved autonomously (preemptive node lockdown).', 'danger');
      if (threatDecayRef.current) clearTimeout(threatDecayRef.current);
      setThreatLevel('CALM');
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

  return (
    <>
      <AutonomousBanner active={isAutonomous} />

      <main
        className={`h-screen w-screen p-3 grid grid-cols-3 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-3 ${
          isAutonomous ? 'mode-autonomous' : 'mode-operator'
        }`}
      >
        <header className="col-span-3 flex items-center justify-between">
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
            {role === 'ADMIN' && (
              <a
                href="/admin"
                className="border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2 py-1 transition-colors"
              >
                Admin panel
              </a>
            )}
          </div>
        </header>

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
