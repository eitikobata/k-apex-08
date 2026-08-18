'use client';

import { useEffect, useState } from 'react';
import { ApiError, kSilenceApi, NodeStatusDto } from '@/lib/api-client';

const NODE_COUNT = 24;
const POLL_MS = 10_000;

// NOTE (honesty flag): GET /k-silence/nodes doesn't exist on the backend
// yet — NetworkNode and SilenceState are already modeled in Prisma, but
// nothing exposes them over HTTP. This component polls the real contract
// and, on a 404, renders all 24 fixed node slots (NODE-01..NODE-24, per the
// simulator seed) in an explicit "awaiting backend" state instead of
// inventing fake statuses. The moment the endpoint lands, this starts
// showing live data with zero frontend changes.
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
      } catch (err) {
        if (cancelled) return;
        setBackendReady(err instanceof ApiError && err.status === 404 ? false : false);
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
    <div className="p-3 h-full flex flex-col gap-2 text-xs">
      {backendReady === false && (
        <p className="text-warn shrink-0">
          Backend endpoint not deployed yet — this grid will populate once GET /k-silence/nodes
          exists. Showing all 24 seeded node slots as unknown.
        </p>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-6 gap-2 auto-rows-min">
        {slots.map((codeName) => {
          const node = nodes.get(codeName);
          return <NodeTile key={codeName} codeName={codeName} node={node ?? null} />;
        })}
      </div>
    </div>
  );
}

function NodeTile({ codeName, node }: { codeName: string; node: NodeStatusDto | null }) {
  const status = node?.status ?? 'UNKNOWN';
  const { border, text, label } = statusStyle(status);

  return (
    <div className={`panel-border bg-panel/60 p-2 flex flex-col gap-1 ${border}`}>
      <span className="font-display text-[11px] tracking-wider text-ash-bright">{codeName}</span>
      <span className={`text-[10px] uppercase tracking-wider ${text}`}>{label}</span>
      {node?.lastHeartbeatAt && (
        <span className="text-[9px] text-ash">
          {new Date(node.lastHeartbeatAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

function statusStyle(status: string): { border: string; text: string; label: string } {
  switch (status) {
    case 'ALIVE':
      return { border: 'border-signal', text: 'text-signal', label: 'Alive' };
    case 'RETRYING':
      return { border: 'border-warn', text: 'text-warn', label: 'Retrying' };
    case 'CONFIRMED_SILENT':
      return { border: 'border-danger', text: 'text-danger', label: 'Silent' };
    case 'RESOLVED':
      return { border: 'border-signal', text: 'text-signal', label: 'Resolved' };
    default:
      return { border: 'border-ash', text: 'text-ash', label: 'Unknown' };
  }
}
