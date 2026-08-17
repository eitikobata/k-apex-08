'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth-store';
import { createConsoleSocket } from '@/lib/socket-client';
import { kDirectiveApi, SystemStateDto } from '@/lib/api-client';
import { Panel } from '@/components/Panel';
import dynamic from 'next/dynamic';

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
  const clearSession = useAuthStore((s) => s.clearSession);

  const [hydrated, setHydrated] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [systemState, setSystemState] = useState<SystemStateDto | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const socketRef = useRef<Socket | null>(null);

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
    s.on('INCIDENT_AWAITING_OPERATOR', (payload: { incidentId: string; tier: string }) => {
      pushFeed(`Incident awaiting operator — tier ${payload.tier} — ${payload.incidentId}`, 'warn');
    });
    s.on('AUTONOMOUS_MODE_CHANGED', (payload: { active: boolean; origin: string }) => {
      pushFeed(`Autonomous mode ${payload.active ? 'ACTIVATED' : 'DEACTIVATED'} (${payload.origin})`, 'danger');
      void refreshSystemState();
    });
    s.on('ROGUE_AI_TRANSITION', (payload: { outcome: string; nextState: string }) => {
      pushFeed(`Rogue AI transition: ${payload.outcome} -> ${payload.nextState}`, 'danger');
    });
    s.on('ROGUE_AI_RESOLVED_AUTONOMOUSLY', () => {
      pushFeed('Rogue AI resolved autonomously (preemptive node lockdown).', 'danger');
    });

    s.connect();

    return () => {
      s.disconnect();
      s.removeAllListeners();
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

  if (!session) return null;

  return (
    <main className="h-screen w-screen p-3 grid grid-cols-3 grid-rows-[auto_1fr] gap-3">
      <header className="col-span-3 flex items-center justify-between">
        <h1 className="font-display text-sm tracking-[0.3em] text-ash-bright uppercase">
          K-APEX-08 <span className="text-ash">{'//'} Kobata Matrix Corporation</span>
        </h1>
        <div className="flex items-center gap-3 text-xs">
          <span className={connected ? 'text-signal' : 'text-danger'}>
            {connected ? '● LINK UP' : '○ LINK DOWN'}
          </span>
          {systemState?.autonomousModeActive && (
            <span className="text-danger font-display tracking-widest">AUTONOMOUS MODE ACTIVE</span>
          )}
        </div>
      </header>

      <Panel title="System state" className="row-span-1">
        <div className="p-3 flex flex-col gap-3 text-xs">
          <Row label="Autonomous mode" value={systemState?.autonomousModeActive ? 'ACTIVE' : 'STANDBY'} />
          <Row label="Origin" value={systemState?.activatedOrigin ?? '—'} />
          <button
            onClick={sendHeartbeat}
            className="mt-2 border border-signal text-signal font-display tracking-widest uppercase text-[10px] py-1.5 hover:bg-signal hover:text-void transition-colors"
          >
            Send heartbeat
          </button>
        </div>
      </Panel>

      <Panel title="Signal feed" className="col-span-2 row-span-1">
        <div className="p-3 flex flex-col gap-1 text-xs overflow-y-auto h-full font-mono">
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
