'use client';

import { useEffect, useState } from 'react';
import { kSilenceApi, NodeStatusDto } from '@/lib/api-client';

const NODE_COUNT = 24;
const POLL_MS = 10_000;

// NOTE (honesty flag): GET /k-silence/nodes doesn't exist on the backend
// yet — NetworkNode and SilenceState are already modeled in Prisma, but
// nothing exposes them over HTTP. This polls the real contract and, on a
// 404, renders all 24 fixed slots (NODE-01..24, per the simulator seed) as
// dim/unlit dots instead of inventing fake statuses.
export function NodeGrid({ accessToken }: { accessToken: string }) {
  const [nodes, setNodes] = useState<Map<string, NodeStatusDto>>(new Map());
  const [backendReady, setBackendReady] = useState<boolean | null>(null);

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

  const slots = Array.from({ length: NODE_COUNT }, (_, i) => `NODE-${String(i + 1).padStart(2, '0')}`);

  return (
    <div className="flex flex-col gap-3 h-full">
      {backendReady === false && (
        <p className="text-warn text-[10px] leading-relaxed">
          GET /k-silence/nodes not deployed yet — dots stay dim until it lands.
        </p>
      )}
      <div className="grid grid-cols-12 gap-2">
        {slots.map((codeName) => {
          const node = nodes.get(codeName);
          return <NodeDot key={codeName} codeName={codeName} status={node?.status ?? null} />;
        })}
      </div>
      <div className="flex gap-4 text-[10px] text-ash mt-auto pt-2">
        <Legend color="bg-signal shadow-[0_0_8px_theme(colors.signal.DEFAULT)]" label="Alive" />
        <Legend color="bg-warn shadow-[0_0_8px_theme(colors.warn.DEFAULT)]" label="Retry" />
        <Legend color="bg-danger shadow-[0_0_8px_theme(colors.danger.DEFAULT)]" label="Silent" />
      </div>
    </div>
  );
}

function NodeDot({ codeName, status }: { codeName: string; status: NodeStatusDto['status'] | null }) {
  const cls =
    status === 'ALIVE' || status === 'RESOLVED'
      ? 'bg-signal border-signal shadow-[0_0_8px_theme(colors.signal.DEFAULT)]'
      : status === 'RETRYING'
        ? 'bg-warn border-warn shadow-[0_0_8px_theme(colors.warn.DEFAULT)]'
        : status === 'CONFIRMED_SILENT'
          ? 'bg-danger border-danger shadow-[0_0_8px_theme(colors.danger.DEFAULT)]'
          : 'bg-grid border-grid';

  return (
    <div
      title={`${codeName} — ${status ?? 'unknown'}`}
      className={`aspect-square rounded-full border ${cls}`}
    />
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
