'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { kSilenceApi, NodeStatusDto } from '@/lib/api-client';

const NODE_COUNT = 24;
const POLL_MS = 10_000;

// GET /k-silence/nodes is real (KSilenceController) — polling stays as the
// source of truth, but NODE_RECOVERY_SCHEDULED / NODE_RECOVERED socket
// events (see console/page.tsx, forwarded here via the socket prop) give
// instant feedback for the 3s recovery window instead of waiting up to
// 10s for the next poll to notice.
export function NodeGrid({ accessToken, socket }: { accessToken: string; socket: Socket | null }) {
  const [nodes, setNodes] = useState<Map<string, NodeStatusDto>>(new Map());
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const list = await kSilenceApi.listNodes(accessToken);
        if (cancelled) return;
        setBackendReady(true);
        setNodes(new Map(list.map((n) => [n.codeName, n])));
      } catch {
        if (cancelled) return;
        setBackendReady(false);
      }
    }
    void poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [accessToken]);

  // Live overrides between polls — RECOVERING needs a ticking countdown,
  // and jumping straight to ALIVE the instant NODE_RECOVERED arrives reads
  // better than waiting on the next poll.
  useEffect(() => {
    if (!socket) return;
    const onScheduled = (payload: { codeName: string; recoverAt: string }) => {
      setNodes((prev) => {
        const next = new Map(prev);
        const existing = next.get(payload.codeName);
        next.set(payload.codeName, {
          codeName: payload.codeName,
          sector: existing?.sector ?? 0,
          status: 'RECOVERING',
          lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
          attemptCount: null,
          maxAttempts: null,
          recoverAt: payload.recoverAt,
        });
        return next;
      });
    };
    const onRecovered = (payload: { codeName: string }) => {
      setNodes((prev) => {
        const next = new Map(prev);
        const existing = next.get(payload.codeName);
        next.set(payload.codeName, {
          codeName: payload.codeName,
          sector: existing?.sector ?? 0,
          status: 'ALIVE',
          lastHeartbeatAt: new Date().toISOString(),
          attemptCount: null,
          maxAttempts: null,
          recoverAt: null,
        });
        return next;
      });
    };
    socket.on('NODE_RECOVERY_SCHEDULED', onScheduled);
    socket.on('NODE_RECOVERED', onRecovered);
    return () => {
      socket.off('NODE_RECOVERY_SCHEDULED', onScheduled);
      socket.off('NODE_RECOVERED', onRecovered);
    };
  }, [socket]);

  // Only ticks while at least one node is actively counting down —
  // no reason to re-render every second when nothing's recovering.
  useEffect(() => {
    const hasRecovering = Array.from(nodes.values()).some((n) => n.status === 'RECOVERING');
    if (!hasRecovering) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [nodes]);

  const slots = Array.from({ length: NODE_COUNT }, (_, i) => `NODE-${String(i + 1).padStart(2, '0')}`);

  return (
    <div className="flex flex-col gap-2 h-full overflow-hidden">
      {backendReady === false && (
        <p className="text-warn text-[10px] leading-relaxed shrink-0">
          GET /k-silence/nodes not reachable — tiles stay dim until it responds.
        </p>
      )}
      <div className="grid grid-cols-12 gap-1.5 shrink-0">
        {slots.map((codeName) => (
          <NodeTile key={codeName} codeName={codeName} node={nodes.get(codeName) ?? null} now={now} />
        ))}
      </div>
      <div className="flex gap-3 text-[10px] text-ash flex-wrap shrink-0">
        <Legend color="bg-signal shadow-[0_0_8px_theme(colors.signal.DEFAULT)]" label="Alive" />
        <Legend color="bg-warn shadow-[0_0_8px_theme(colors.warn.DEFAULT)]" label="Retry" />
        <Legend color="bg-signal/60 shadow-[0_0_8px_theme(colors.signal.DEFAULT)]" label="Recovering" />
        <Legend color="bg-danger shadow-[0_0_8px_theme(colors.danger.DEFAULT)]" label="Silent" />
      </div>
    </div>
  );
}

function NodeTile({ codeName, node, now }: { codeName: string; node: NodeStatusDto | null; now: number }) {
  const status = node?.status ?? null;
  const cls =
    status === 'ALIVE' || status === 'RESOLVED'
      ? 'bg-signal/20 border-signal shadow-[0_0_8px_theme(colors.signal.DEFAULT)]'
      : status === 'RETRYING'
        ? 'bg-warn/20 border-warn shadow-[0_0_8px_theme(colors.warn.DEFAULT)]'
        : status === 'RECOVERING'
          ? 'bg-signal/10 border-signal/60 shadow-[0_0_6px_theme(colors.signal.DEFAULT)]'
          : status === 'CONFIRMED_SILENT'
            ? 'bg-danger/20 border-danger shadow-[0_0_8px_theme(colors.danger.DEFAULT)]'
            : 'bg-grid/40 border-grid';

  const secondsLeft =
    status === 'RECOVERING' && node?.recoverAt ? Math.max(0, (new Date(node.recoverAt).getTime() - now) / 1000) : null;

  return (
    <div
      title={`${codeName} — ${status ?? 'unknown'}`}
      className={`node-tile-clip aspect-square border flex flex-col items-center justify-center gap-0.5 transition-colors ${cls}`}
    >
      {status === 'RETRYING' && node?.attemptCount != null && (
        <span className="text-warn text-[9px] font-mono leading-none">
          {node.attemptCount}/{node.maxAttempts}
        </span>
      )}
      {secondsLeft !== null && <span className="text-signal text-[9px] font-mono leading-none">{secondsLeft.toFixed(1)}s</span>}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 ${color}`} />
      {label}
    </span>
  );
}
