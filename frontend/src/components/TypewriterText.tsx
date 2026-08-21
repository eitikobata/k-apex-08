'use client';

import { useEffect, useState } from 'react';
import { playSound } from '@/lib/sound-effects';

const CHAR_INTERVAL_MS = 15;
const SOUND_EVERY_N_CHARS = 8; // fx-typing.mp3 is ~0.4s — playing every char
// would layer into a wall of noise; every 8th gives a discrete "clack, clack"
// texture instead, roughly one click every ~120ms.

/**
 * Reveals `text` character by character, playing a typing click every
 * SOUND_EVERY_N_CHARS. Remounts (via the `key` prop the caller passes,
 * typically incidentId+text) restart the reveal from scratch — this
 * component itself doesn't try to detect "is this the same text as
 * before", that's the caller's job.
 */
export function TypewriterText({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    if (!text) return;
    const interval = setInterval(() => {
      setRevealed((r) => {
        const next = Math.min(text.length, r + 1);
        if (next % SOUND_EVERY_N_CHARS === 0 && next < text.length) {
          playSound('typing');
        }
        if (next >= text.length) clearInterval(interval);
        return next;
      });
    }, CHAR_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <>
      {text.slice(0, revealed)}
      {revealed < text.length && <span className="animate-pulse">▋</span>}
    </>
  );
}
