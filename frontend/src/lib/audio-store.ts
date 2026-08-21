import { create } from 'zustand';

const STORAGE_KEY = 'kapex08.audio-muted';

interface AudioState {
  muted: boolean;
  toggleMute: () => void;
  hydrate: () => void;
}

/**
 * Same shape as auth-store.ts/threat-store.ts — global, not tied to any
 * component's position in the tree, so both the ambient player (mounted
 * once in layout.tsx) and every one-off sound effect (fired from wherever)
 * read the same mute flag without prop-drilling it through the whole app.
 * Persisted to localStorage (not sessionStorage like the auth session —
 * mute preference should survive closing the tab, it's not sensitive).
 */
export const useAudioStore = create<AudioState>((set, get) => ({
  muted: false,

  toggleMute: () => {
    const next = !get().muted;
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, String(next));
    }
    set({ muted: next });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) set({ muted: raw === 'true' });
  },
}));
