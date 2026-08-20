'use client';

import { useEffect, useState } from 'react';

const DURATION_MS = 7000;

function randomHex(): string {
  return `0x${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

function randomAddrLine(): string {
  return `0x${Math.floor(Math.random() * 0xff).toString(16).toUpperCase().padStart(2, '0')}, ADDR:0x${Math.floor(Math.random() * 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Pre-login boot screen — plays once on mount, ~7s, then calls onDone.
 * Reference was a Windows-9x-style boot screen: scrolling hex/address
 * noise flanking a centered title, a small "still working" dot glyph, and
 * a status line that flips to READY near the end. Deliberately built to
 * accept an audio track later (audioSrc prop) rather than needing a
 * rewrite when one shows up — currently unset, so no sound plays.
 */
export function BootScreen({ onDone, audioSrc }: { onDone: () => void; audioSrc?: string }) {
  const [leftLines, setLeftLines] = useState<string[]>([]);
  const [rightLines, setRightLines] = useState<string[]>([]);
  const [status, setStatus] = useState('INITIALIZING');
  const [showTitle, setShowTitle] = useState(false);

  useEffect(() => {
    // Random content generated client-side only, after mount — same
    // hydration-mismatch reasoning as BackgroundColumns.tsx (Math.random()
    // during SSR vs. client render produces different output).
    setLeftLines(Array.from({ length: 9 }, randomAddrLine));
    setRightLines(Array.from({ length: 9 }, () => `${randomHex()}, ADDR:${randomHex()}`));

    const titleTimer = setTimeout(() => setShowTitle(true), 400);
    const readyTimer = setTimeout(() => setStatus('READY'), DURATION_MS - 1200);
    const doneTimer = setTimeout(onDone, DURATION_MS);

    const scrollInterval = setInterval(() => {
      setLeftLines((prev) => [...prev.slice(1), randomAddrLine()]);
      setRightLines((prev) => [...prev.slice(1), `${randomHex()}, ADDR:${randomHex()}`]);
    }, 550);

    return () => {
      clearTimeout(titleTimer);
      clearTimeout(readyTimer);
      clearTimeout(doneTimer);
      clearInterval(scrollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[900] bg-void overflow-hidden font-mono text-danger text-[11px]">
      {/* Ambient red glow across the top, matching the reference. */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-danger/25 to-transparent pointer-events-none" />

      <div className="absolute left-4 top-6 flex flex-col gap-2 opacity-50">
        {leftLines.map((line, i) => (
          <span key={i}>: {line}</span>
        ))}
      </div>
      <div className="absolute right-4 top-6 flex flex-col gap-2 opacity-50 text-right">
        {rightLines.map((line, i) => (
          <span key={i}>: {line}</span>
        ))}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
        <DotGlyph />
        {showTitle && (
          <div className="node-tile-clip border-2 border-danger px-6 py-2 bg-void">
            <span className="font-display text-base tracking-[0.3em] text-danger uppercase">System reboot</span>
          </div>
        )}
      </div>

      <div className="absolute bottom-6 left-4 text-ash text-[10px] tracking-wider">
        LOAD ADDRESS: 0x12000000
      </div>
      <div className="absolute bottom-6 right-4 text-ash text-[10px] tracking-wider">
        STATUS: <span className={status === 'READY' ? 'text-signal' : 'text-warn'}>{status}</span>
      </div>

      {audioSrc && <audio src={audioSrc} autoPlay />}
    </div>
  );
}

/** Small "still alive" glyph — a plus-shaped cluster of dots, pulsing. */
function DotGlyph() {
  const positions = [
    [1, 0], [0, 1], [1, 1], [2, 1], [1, 2],
  ];
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-1.5 w-8 h-8">
      {Array.from({ length: 9 }, (_, i) => {
        const x = i % 3;
        const y = Math.floor(i / 3);
        const active = positions.some(([px, py]) => px === x && py === y);
        return (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-danger animate-pulse' : 'bg-transparent'}`}
            style={active ? { animationDelay: `${(x + y) * 120}ms` } : undefined}
          />
        );
      })}
    </div>
  );
}
