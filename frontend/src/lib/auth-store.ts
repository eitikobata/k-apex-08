import { create } from 'zustand';

export interface OperatorSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

interface AuthState {
  session: OperatorSession | null;
  /** Decoded from the access token's payload — UI-only, never trust this for real authorization. */
  role: string | null;
  /**
   * Decoded `sub` claim (the operator's id). The access token has no
   * callsign — only { sub, role } (see TokenService.issueTokenPair on the
   * backend) — so this is only ever a fallback display value. AccountMenu.tsx
   * fetches the real callsign via GET /k-id/me and prefers that; this is
   * just what shows before that call resolves, or if it fails.
   */
  operatorId: string | null;
  setSession: (session: OperatorSession) => void;
  clearSession: () => void;
  hydrate: () => void;
}

const STORAGE_KEY = 'kapex08.session';

/**
 * Reads the JWT payload without verifying the signature — that's fine here,
 * because this value only ever drives UI decisions (show/hide the admin
 * button). Every actual privileged action is re-checked server-side
 * (RolesGuard / PermissionsGuard), so a tampered client-side value can't
 * grant real access, only a misleading button.
 */
function decodeJwtPayload(token: string): { role: string | null; operatorId: string | null } {
  try {
    const payloadB64 = token.split('.')[1];
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { role?: string; sub?: string };
    return { role: payload.role ?? null, operatorId: payload.sub ?? null };
  } catch {
    return { role: null, operatorId: null };
  }
}

/**
 * sessionStorage, not localStorage: the session dies with the tab, which is
 * the right default for an ops console — no lingering credentials in a
 * shared/kiosk browser profile. Refresh-token rotation (backend-side)
 * still protects a stolen token even within a session's lifetime.
 */
export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  role: null,
  operatorId: null,

  setSession: (session) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    set({ session, ...decodeJwtPayload(session.accessToken) });
  },

  clearSession: () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    set({ session: null, role: null, operatorId: null });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const session = JSON.parse(raw) as OperatorSession;
      set({ session, ...decodeJwtPayload(session.accessToken) });
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  },
}));
