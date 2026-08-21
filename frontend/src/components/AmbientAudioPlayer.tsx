'use client';

import { useEffect, useRef } from 'react';
import { useAudioStore } from '@/lib/audio-store';

const AMBIENT_VOLUME = 0.14;

/**
 * Mounted once in layout.tsx (not per-page) so the loop survives
 * navigation between login -> console -> admin without restarting or
 * gapping. Starts trying to play the moment this mounts (i.e. the moment
 * the login screen loads, per the request) — browsers routinely block
 * autoplay-with-sound before any user gesture has happened on the page,
 * so this also attaches a one-time listener on the first click/keydown
 * anywhere and retries then. Once it's playing, it just keeps looping;
 * toggling mute doesn't restart it, it actually mutes the element (so
 * un-muting resumes mid-loop instead of jumping back to 0:00).
 */
export function AmbientAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const muted = useAudioStore((s) => s.muted);
  const hydrate = useAudioStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = AMBIENT_VOLUME;

    const tryPlay = () => {
      audio.play().catch(() => {
        // Autoplay blocked — wait for the first real interaction anywhere
        // on the page and try again. Removes itself after firing once.
        const retry = () => {
          audio.play().catch(() => {});
          window.removeEventListener('click', retry);
          window.removeEventListener('keydown', retry);
        };
        window.addEventListener('click', retry, { once: true });
        window.addEventListener('keydown', retry, { once: true });
      });
    };

    tryPlay();
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  return <audio ref={audioRef} src="/audio/ambient-defrag.mp3" loop preload="auto" />;
}
