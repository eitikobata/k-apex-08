'use client';

import { useEffect, useState } from 'react';
import { kIdAdminApi } from '@/lib/api-client';

// Mirrors PERMISSION_SCOPES in permission-scopes.ts on the backend — that's
// the source of truth, this is just the human-readable pairing for the UI.
// ADMIN accounts bypass all of these server-side (PermissionsGuard), so
// this only ever matters for OPERATOR/SENIOR_OPERATOR.
const SCOPES: { value: string; label: string; desc: string }[] = [
  { value: 'kuro_ice:approve_splice', label: 'Approve SPLICE', desc: 'Confirm SPLICE-tier incidents (also covers LATCH — same command).' },
  { value: 'kuro_ice:approve_shatter', label: 'Approve SHATTER', desc: 'Confirm SHATTER-tier incidents.' },
  { value: 'k_directive:toggle_autonomous', label: 'Toggle autonomous', desc: 'Manually activate or stand down autonomous mode.' },
  { value: 'rogue_ai:issue_command', label: 'Rogue AI commands', desc: 'Issue ISOLATE / TRACE / PURGE during containment.' },
];

export function OperatorPermissionsModal({
  accessToken,
  operatorId,
  operatorCallsign,
  onClose,
}: {
  accessToken: string;
  operatorId: string;
  operatorCallsign: string;
  onClose: () => void;
}) {
  const [granted, setGranted] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);

  useEffect(() => {
    kIdAdminApi
      .listPermissions(accessToken, operatorId)
      .then((res) => setGranted(new Set(res.scopes)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load permissions.'));
  }, [accessToken, operatorId]);

  async function toggle(scope: string, currentlyGranted: boolean) {
    setBusyScope(scope);
    setError(null);
    try {
      if (currentlyGranted) {
        await kIdAdminApi.revokePermission(accessToken, operatorId, scope);
      } else {
        await kIdAdminApi.grantPermission(accessToken, operatorId, scope);
      }
      setGranted((prev) => {
        const next = new Set(prev);
        if (currentlyGranted) next.delete(scope);
        else next.add(scope);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permission.');
    } finally {
      setBusyScope(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[600] bg-void/80 flex items-center justify-center" onClick={onClose}>
      <div className="panel-border bg-panel w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b-2 border-danger px-3 py-2 flex items-center justify-between">
          <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">
            [ Permissions — {operatorCallsign} ]
          </span>
          <button onClick={onClose} className="text-ash hover:text-ash-bright text-xs">
            close ✕
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs">
          {granted === null && !error && <p className="text-ash">Loading…</p>}
          {error && <p className="text-danger">{error}</p>}

          {granted !== null &&
            SCOPES.map((s) => {
              const isGranted = granted.has(s.value);
              return (
                <div key={s.value} className="flex items-start justify-between gap-3 border-b border-grid pb-2 last:border-b-0">
                  <div>
                    <div className="text-ash-bright">{s.label}</div>
                    <div className="text-ash text-[10px] leading-snug">{s.desc}</div>
                  </div>
                  <button
                    onClick={() => toggle(s.value, isGranted)}
                    disabled={busyScope === s.value}
                    className={`shrink-0 border font-display tracking-widest uppercase text-[10px] px-2.5 py-1 transition-colors disabled:opacity-40 ${
                      isGranted
                        ? 'border-signal text-signal hover:bg-signal hover:text-void'
                        : 'border-ash text-ash hover:border-ash-bright hover:text-ash-bright'
                    }`}
                  >
                    {busyScope === s.value ? '…' : isGranted ? 'Granted' : 'Grant'}
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
