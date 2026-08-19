'use client';

import { useEffect, useState } from 'react';
import { useThreatStore } from '@/lib/threat-store';

const ALERT_LINES = Array.from({ length: 30 }, () => 'ALERT!');

const COL1 = [
  'Node telemetry baseline recalibrated.',
  'Reviewing K-SILENCE retry thresholds for sector 4.',
  'Operator shift handoff logged.',
  'Subspace stream backlog nominal.',
  'K-BLACKBOX embedding cache warmed.',
  'Reminder: rotate refresh token secrets Q3.',
  'Perimeter integrity check scheduled 04:00.',
  'Rogue signature model updated to v3.2.',
  'KURO-ICE cooldown timers verified.',
  'Case file retention policy: 180 days.',
  'Operator permissions audit pending.',
  'Autonomous fallback rehearsal completed.',
  'Sector 7 node roster reconciled.',
  'Blacktape archive checksum verified.',
];

const COL2 = [
  '$ systemctl status k-directive',
  '$ docker logs kapex08-backend --tail 50',
  '$ redis-cli -n 8 xinfo stream k-stream:incidents',
  '$ psql -d kapex08 -c "select count(*) from incidents;"',
  '$ npx prisma migrate deploy',
  '$ curl -s https://api/k-directive/autonomous-mode',
  '$ tail -f /var/log/kapex08/blacktape.log',
  '$ kubectl get pods -n kmc-prod',
  "$ ssh ops@edge-07 'uptime'",
  '$ git log --oneline -5',
  '$ npm run test:mutation',
  '$ docker compose restart k-silence',
];

function randomHex(): string {
  const part = () =>
    `0x${Math.floor(Math.random() * 0xffff)
      .toString(16)
      .toUpperCase()
      .padStart(4, '0')}`;
  return `${part()}  ${part()}  ${part()}  ${part()}`;
}

function randomBinary(): string {
  const part = () => Math.floor(Math.random() * 256).toString(2).padStart(8, '0');
  return `${part()} ${part()} ${part()} ${part()}`;
}

function Column({
  lines,
  durationSec,
  alert = false,
}: {
  lines: string[];
  durationSec: number;
  alert?: boolean;
}) {
  // Duplicated once — this is what lets translateY(-50%) loop with no seam.
  const content = [...lines, ...lines].join('\n');
  return (
    <div className={`bg-col ${alert ? 'bg-col-alert' : ''}`}>
      <div className="bg-col-inner" style={{ ['--bg-scroll-duration' as string]: `${durationSec}s` }}>
        {content}
      </div>
    </div>
  );
}

// NOTE (bugfix, pre-existing — not introduced by the console rewrite):
// Math.random() run inside useMemo executes on both the server render and
// the client's hydration render, and produces different digits each time —
// classic hydration mismatch. useEffect only ever runs client-side, after
// hydration completes, so the random content is generated once, safely,
// after React has already reconciled a matching (empty) first paint.
//
// NOTE (scoped variant): `.bg-columns` is `position:fixed; z-index:-1` —
// correct in theory (negative z-index always paints behind normal-flow
// content) but after repeated reports that it's invisible specifically on
// the console page and not elsewhere, and no way to check a real browser
// from here, `scoped` sidesteps the theory entirely instead of trying to
// out-guess it a fourth time. When true, this renders as a plain
// `position:absolute inset-0 z-0` FIRST CHILD of a `position:relative`
// parent — a single, local stacking context with no dependency on
// cross-page layout, global CSS, or how any other fixed/negative-z layer
// on the page behaves. Normal-flow siblings rendered after it in the DOM
// (the console's panels) paint on top by plain DOM order, no z-index
// theory required. If it's STILL invisible after this, the bug isn't
// stacking-related at all — worth checking with DevTools whether the
// element exists and has non-zero size (see console/page.tsx).
export function BackgroundColumns({ scoped = false }: { scoped?: boolean } = {}) {
  const [hexLines, setHexLines] = useState<string[]>([]);
  const [binLines, setBinLines] = useState<string[]>([]);
  const alert = useThreatStore((s) => s.rogueAiActive);

  useEffect(() => {
    setHexLines(Array.from({ length: 26 }, randomHex));
    setBinLines(Array.from({ length: 26 }, randomBinary));
  }, []);

  // During an active Rogue AI incident, all four columns switch to the
  // same thing — big, red, repeated "ALERT!" — instead of their normal
  // content. Thematic escalation of the same ambient layer rather than a
  // separate effect: the thing that's always quietly there gets loud.
  return (
    <div
      className="bg-columns"
      style={scoped ? { position: 'absolute', zIndex: 0 } : undefined}
      aria-hidden="true"
    >
      <Column lines={alert ? ALERT_LINES : COL1} durationSec={alert ? 14 : 42} alert={alert} />
      <Column lines={alert ? ALERT_LINES : COL2} durationSec={alert ? 16 : 58} alert={alert} />
      <Column lines={alert ? ALERT_LINES : hexLines} durationSec={alert ? 13 : 34} alert={alert} />
      <Column lines={alert ? ALERT_LINES : binLines} durationSec={alert ? 15 : 49} alert={alert} />
    </div>
  );
}
