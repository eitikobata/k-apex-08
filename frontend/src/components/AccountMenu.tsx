'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { kIdApi } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { ChangePasswordModal } from './ChangePasswordModal';

// NOTE (honesty flag): the access token only carries { sub, role } — no
// callsign (see TokenService.issueTokenPair on the backend). The chip shows
// role + a truncated operator id instead of a display name; a real
// callsign needs a GET /k-id/me endpoint that doesn't exist yet.
export function AccountMenu({ accessToken }: { accessToken: string }) {
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);
  const role = useAuthStore((s) => s.role);
  const operatorId = useAuthStore((s) => s.operatorId);

  const [open, setOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);

  async function handleLogout() {
    try {
      await kIdApi.logout(accessToken);
    } catch {
      // Best-effort — the refresh token gets revoked server-side either way
      // on next use if this call fails; the client session is cleared
      // regardless so the operator isn't stuck.
    } finally {
      clearSession();
      router.replace('/login');
    }
  }

  async function handleRegisterPasskey() {
    setPasskeyBusy(true);
    setPasskeyMessage(null);
    try {
      // Dynamic import: this is the only place in the app that needs
      // @simplewebauthn/browser, and it touches navigator.credentials,
      // which doesn't exist during SSR — no reason to pull it into every
      // console page load.
      const { startRegistration } = await import('@simplewebauthn/browser');
      type RegistrationOptionsJSON = Parameters<typeof startRegistration>[0];
      const options = await kIdApi.webauthnRegistrationOptions(accessToken);
      const attestation = await startRegistration(options as unknown as RegistrationOptionsJSON);
      const label = window.prompt('Label this device (e.g. "YubiKey", "MacBook Touch ID"):') ?? undefined;
      await kIdApi.webauthnRegistrationVerify(accessToken, attestation, label);
      setPasskeyMessage('Passkey registered.');
    } catch (err) {
      setPasskeyMessage(
        err instanceof Error ? `Passkey registration failed: ${err.message}` : 'Passkey registration failed.',
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-void flex items-center gap-2 border border-grid hover:border-ash px-2.5 py-1 transition-colors"
      >
        <span className="text-ash-bright text-[11px]">{operatorId ? `#${operatorId.slice(0, 8)}…` : '—'}</span>
        <span className="text-danger text-[10px] tracking-wider">{role ?? '—'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[500]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-[501] panel-border bg-panel w-56 text-xs">
            <MenuItem
              label="Change password"
              onClick={() => {
                setOpen(false);
                setShowPasswordModal(true);
              }}
            />
            <MenuItem
              label={passkeyBusy ? 'Registering…' : 'Register passkey'}
              disabled={passkeyBusy}
              onClick={() => void handleRegisterPasskey()}
            />
            <MenuItem label="Log out" danger onClick={handleLogout} />
            {passkeyMessage && (
              <div className="px-3 py-2 border-t border-grid text-ash">{passkeyMessage}</div>
            )}
          </div>
        </>
      )}

      {showPasswordModal && (
        <ChangePasswordModal accessToken={accessToken} onClose={() => setShowPasswordModal(false)} />
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-2 border-b border-grid last:border-b-0 hover:bg-grid/40 transition-colors disabled:opacity-40 ${
        danger ? 'text-danger' : 'text-ash-bright'
      }`}
    >
      {label}
    </button>
  );
}
