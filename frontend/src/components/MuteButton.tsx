'use client';

import { useEffect } from 'react';
import { useAudioStore } from '@/lib/audio-store';

/**
 * Mounted globally in layout.tsx (not TopBar) on purpose — the login page
 * doesn't use TopBar at all, and the ambient loop starts exactly there, so
 * the mute control has to exist outside any one page's chrome. Fixed
 * corner position, same z-index tier as the other always-on-top overlays.
 */
export function MuteButton() {
  const muted = useAudioStore((s) => s.muted);
  const toggleMute = useAudioStore((s) => s.toggleMute);
  const hydrate = useAudioStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <button
      onClick={toggleMute}
      title={muted ? 'Unmute' : 'Mute'}
      className="fixed bottom-3 right-3 z-[950] bg-void border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2.5 py-1.5 transition-colors"
    >
      {muted ? '🔇 Muted' : '🔊 Sound'}
    </button>
  );
}
