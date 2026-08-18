'use client';

import { useState } from 'react';
import { kIdApi } from '@/lib/api-client';

export function ChangePasswordModal({
  accessToken,
  onClose,
}: {
  accessToken: string;
  onClose: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await kIdApi.changePassword(accessToken, currentPassword, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[600] bg-void/80 flex items-center justify-center" onClick={onClose}>
      <div
        className="panel-border bg-panel w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b-2 border-danger px-3 py-2">
          <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">
            [ Change password ]
          </span>
        </div>
        <div className="p-4">
          {done ? (
            <div className="flex flex-col gap-3 text-xs">
              <p className="text-signal">Password changed successfully.</p>
              <button
                onClick={onClose}
                className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] py-1.5 hover:bg-signal hover:text-void transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-xs">
              <PwField label="Current password" value={currentPassword} onChange={setCurrentPassword} />
              <PwField label="New password" value={newPassword} onChange={setNewPassword} />
              <PwField label="Confirm new password" value={confirm} onChange={setConfirm} />
              {error && <p className="text-danger">{error}</p>}
              <div className="flex gap-2 mt-1">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 border border-signal text-signal font-display tracking-widest uppercase text-[10px] py-1.5 hover:bg-signal hover:text-void transition-colors disabled:opacity-50"
                >
                  {busy ? 'Working…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 border border-ash text-ash font-display tracking-widest uppercase text-[10px] py-1.5 hover:border-ash-bright hover:text-ash-bright transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function PwField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-ash tracking-widest uppercase">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={8}
        className="bg-void panel-border px-2 py-1.5 text-ash-bright outline-none focus:border-signal"
      />
    </label>
  );
}
