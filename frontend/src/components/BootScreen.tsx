'use client';

import { useEffect, useState } from 'react';
import { useAudioStore } from '@/lib/audio-store';

const DURATION_MS = 8050; // matches loading-boot.mp3's real length exactly
const SPINNER_FRAMES = ['/', '-', '\\', '|'];
const SPINNER_INTERVAL_MS = 120;

// Our own modules, not generic hacker-movie noise — this is the console's
// actual boot log, in spirit. First boot on this browser only ever gets
// called that once, so "BOOT" not "REBOOT" (matches K-APEX-08's own
// module naming instead of the CP77-flavored reference image).
const BOOT_LOG = [
  'K-APEX-08 KERNEL v0.8',
  'checking K-ID auth substrate... OK',
  'mounting SUBSPACE K-STREAM... OK',
  'initializing K-DIRECTIVE 08... OK',
  'arming KURO-ICE countermeasures... OK',
  'polling K-SILENCE node grid (24)... OK',
  'syncing K-BLACKBOX archive... OK',
  'verifying K-BLACKTAPE integrity... OK',
  'handshake: ROGUE AI detector... OK',
  'DEAD WALL perimeter... ONLINE',
];

/**
 * Pre-login boot screen — plays once on mount, then calls onDone.
 * Redesigned from an earlier version that leaned too hard on the
 * screenshot reference someone sent (hex noise columns, generic dot
 * glyph) — this version is built from what the project already has: a
 * classic `/ | \ -` ASCII spinner and a boot log naming K-APEX-08's own
 * modules instead of decoration borrowed from somewhere else.
 */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [status, setStatus] = useState('BOOTING');
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const muted = useAudioStore((s) => s.muted);
  const hydrate = useAudioStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const lineIntervalMs = (DURATION_MS - 1500) / BOOT_LOG.length;
    const logInterval = setInterval(() => {
      setRevealedCount((c) => Math.min(BOOT_LOG.length, c + 1));
    }, lineIntervalMs);

    const spinnerInterval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    const readyTimer = setTimeout(() => setStatus('READY'), DURATION_MS - 900);
    const doneTimer = setTimeout(onDone, DURATION_MS);

    return () => {
      clearInterval(logInterval);
      clearInterval(spinnerInterval);
      clearTimeout(readyTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[900] bg-void overflow-hidden font-mono text-danger text-[11px] flex flex-col items-center justify-center gap-6 px-6">
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-danger/25 to-transparent pointer-events-none" />

      <div className="w-full max-w-md flex flex-col gap-1 text-[10px]">
        {BOOT_LOG.slice(0, revealedCount).map((line, i) => (
          <span key={i} className="text-ash">
            <span className="text-danger">{'>'}</span> {line}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="w-4 text-center text-danger">{SPINNER_FRAMES[spinnerFrame]}</span>
        <div className="node-tile-clip border-2 border-danger px-6 py-2 bg-void">
          <span className="font-display text-base tracking-[0.3em] text-danger uppercase">System boot</span>
        </div>
      </div>

      <div className="absolute bottom-6 left-4 text-ash text-[10px] tracking-wider">
        LOAD ADDRESS: 0x12000000
      </div>
      <div className="absolute bottom-6 right-4 text-ash text-[10px] tracking-wider">
        STATUS: <span className={status === 'READY' ? 'text-signal' : 'text-warn'}>{status}</span>
      </div>

      {!muted && <audio src="/audio/loading-boot.mp3" autoPlay />}
    </div>
  );
}
