'use client';

import { useEffect, useState } from 'react';

const DURATION_MS = 3800;

const FLAVOR_LINES = [
  'ALLOC 0x01 + DECOMPRESS MEM/DIR',
  'K-ID SESSION HANDSHAKE: OK',
  'SUBSPACE K-STREAM: LINKING',
  'DIAGNOSTIC EXPORT: DONE',
];

/**
 * Post-login loading bar — plays once, ~3.5-4s, then calls onDone (the
 * caller navigates to /console after). Same audio-hook pattern as
 * BootScreen.tsx: accepts an optional audioSrc, currently unset.
 */
export function LoadingBar({ onDone, audioSrc }: { onDone: () => void; audioSrc?: string }) {
  const [pct, setPct] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const next = Math.min(100, Math.round((elapsed / DURATION_MS) * 100));
      setPct(next);
      setLineIndex(Math.min(FLAVOR_LINES.length - 1, Math.floor((next / 100) * FLAVOR_LINES.length)));
    }, 60);

    const doneTimer = setTimeout(onDone, DURATION_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[900] bg-void flex flex-col items-center justify-center gap-3 px-6">
      <div className="node-tile-clip border-2 border-danger px-6 py-2 bg-void mb-2">
        <span className="font-display text-base tracking-[0.3em] text-danger uppercase">System reboot</span>
      </div>

      <div className="w-full max-w-md h-3 bg-grid overflow-hidden">
        <div
          className="h-full bg-danger shadow-[0_0_16px_theme(colors.danger.DEFAULT)] transition-[width] duration-100"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="w-full max-w-md flex items-center justify-between font-mono text-[10px] text-ash">
        <span>{FLAVOR_LINES[lineIndex]}</span>
        <span className="text-danger">{pct}%</span>
      </div>

      {audioSrc && <audio src={audioSrc} autoPlay />}
    </div>
  );
}
