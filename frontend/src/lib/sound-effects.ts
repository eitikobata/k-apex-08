import { useAudioStore } from './audio-store';

export type SoundKey =
  | 'hover'
  | 'select'
  | 'nav'
  | 'typing'
  | 'alert-latch'
  | 'alert-splice'
  | 'alert-shatter'
  | 'alert-rogue-ai';

// Volumes tuned per how often each one fires — hover triggers constantly
// while mousing around a dense dashboard, so it's kept near-subliminal;
// alerts fire rarely and should actually grab attention, scaling up with
// severity the same way the rest of the app already does (tier colors,
// AI-resolve odds, deadline windows).
const SOUND_FILES: Record<SoundKey, { src: string; volume: number }> = {
  hover: { src: '/audio/fx-hover.mp3', volume: 0.12 },
  select: { src: '/audio/fx-select.mp3', volume: 0.35 },
  nav: { src: '/audio/fx-nav.mp3', volume: 0.4 },
  typing: { src: '/audio/fx-typing.mp3', volume: 0.22 },
  'alert-latch': { src: '/audio/alert-latch.mp3', volume: 0.4 },
  'alert-splice': { src: '/audio/alert-splice.mp3', volume: 0.5 },
  'alert-shatter': { src: '/audio/alert-shatter.mp3', volume: 0.6 },
  'alert-rogue-ai': { src: '/audio/alert-rogue-ai.mp3', volume: 0.65 },
};

/**
 * Fires a one-shot effect. A fresh `Audio()` instance per call on purpose —
 * these can legitimately overlap (e.g. hovering fast, or a typing click
 * landing while a select sound is still finishing) and reusing one shared
 * instance would cut the previous play short instead of layering. Browser
 * autoplay policy can reject `.play()` if it's called with zero prior user
 * interaction on the page; that's swallowed silently rather than thrown —
 * a missing click sound is not worth a console error over.
 */
export function playSound(key: SoundKey): void {
  if (typeof window === 'undefined') return;
  if (useAudioStore.getState().muted) return;
  const { src, volume } = SOUND_FILES[key];
  const audio = new Audio(src);
  audio.volume = volume;
  audio.play().catch(() => {});
}
