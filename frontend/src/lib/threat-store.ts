import { create } from 'zustand';

interface ThreatState {
  rogueAiActive: boolean;
  setRogueAiActive: (active: boolean) => void;
}

/**
 * BackgroundColumns lives in layout.tsx (mounted once, above every page —
 * console, login, admin), so it has no props connection to ConsolePage's
 * local rogueAiActive state. Zustand state isn't tied to React's tree
 * position the way context/props are, so this is the simplest bridge:
 * ConsolePage writes to it, BackgroundColumns reads it, no prop drilling
 * or lifting state into the layout (which is a server component and
 * couldn't hold this anyway).
 */
export const useThreatStore = create<ThreatState>((set) => ({
  rogueAiActive: false,
  setRogueAiActive: (active) => set({ rogueAiActive: active }),
}));
