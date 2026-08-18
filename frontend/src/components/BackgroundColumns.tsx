'use client';

import { useMemo } from 'react';

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

function Column({ lines, durationSec }: { lines: string[]; durationSec: number }) {
  // Duplicated once — this is what lets translateY(-50%) loop with no seam.
  const content = [...lines, ...lines].join('\n');
  return (
    <div className="bg-col">
      <div className="bg-col-inner" style={{ ['--bg-scroll-duration' as string]: `${durationSec}s` }}>
        {content}
      </div>
    </div>
  );
}

export function BackgroundColumns() {
  const hexLines = useMemo(() => Array.from({ length: 26 }, randomHex), []);
  const binLines = useMemo(() => Array.from({ length: 26 }, randomBinary), []);

  return (
    <div className="bg-columns" aria-hidden="true">
      <Column lines={COL1} durationSec={42} />
      <Column lines={COL2} durationSec={58} />
      <Column lines={hexLines} durationSec={34} />
      <Column lines={binLines} durationSec={49} />
    </div>
  );
}
