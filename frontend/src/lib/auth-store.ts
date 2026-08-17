import { create } from 'zustand';

export interface OperatorSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

interface AuthState {
  session: OperatorSession | null;
  setSession: (session: OperatorSession) => void;
  clearSession: () => void;
  hydrate: () => void;
}

const STORAGE_KEY = 'kapex08.session';

/**
 * sessionStorage, not localStorage: the session dies with the tab, which is
 * the right default for an ops console — no lingering credentials in a
 * shared/kiosk browser profile. Refresh-token rotation (backend-side)
 * still protects a stolen token even within a session's lifetime.
 */
export const useAuthStore = create<AuthState>((set) => ({
  session: null,

  setSession: (session) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    set({ session });
  },

  clearSession: () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    set({ session: null });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      set({ session: JSON.parse(raw) as OperatorSession });
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  },
}));
