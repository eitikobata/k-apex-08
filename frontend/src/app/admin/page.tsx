'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { kIdApi, kIdAdminApi, OperatorSummaryDto } from '@/lib/api-client';
import { Panel } from '@/components/Panel';
import { BackgroundColumns } from '@/components/BackgroundColumns';
import { OperatorPermissionsModal } from '@/components/OperatorPermissionsModal';
import { playSound } from '@/lib/sound-effects';

const ROLES = ['ADMIN', 'SENIOR_OPERATOR', 'OPERATOR', 'OBSERVER'] as const;

export default function AdminPage() {
  const router = useRouter();
  const hydrate = useAuthStore((s) => s.hydrate);
  const session = useAuthStore((s) => s.session);
  const role = useAuthStore((s) => s.role);

  const [hydrated, setHydrated] = useState(false);
  const [operators, setOperators] = useState<OperatorSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<{ id: string; callsign: string } | null>(null);

  useEffect(() => {
    hydrate();
    setHydrated(true);
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (role !== 'ADMIN') {
      router.replace('/console');
    }
  }, [hydrated, session, role, router]);

  async function loadOperators() {
    if (!session) return;
    setListError(null);
    try {
      const list = await kIdAdminApi.listOperators(session.accessToken);
      setOperators(list);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load operators.');
    }
  }

  useEffect(() => {
    if (session && role === 'ADMIN') void loadOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, role]);

  async function handleRevoke(operatorId: string) {
    if (!session) return;
    try {
      await kIdAdminApi.revokeOperatorSessions(session.accessToken, operatorId);
      setActionMessage(`Sessions revoked for ${operatorId}.`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Revoke failed.');
    }
  }

  async function handleDelete(operatorId: string) {
    if (!session) return;
    if (!confirm('Permanently delete this operator? This cannot be undone.')) return;
    try {
      await kIdAdminApi.deleteOperator(session.accessToken, operatorId);
      setActionMessage(`Operator ${operatorId} deleted.`);
      void loadOperators();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  async function handleResetPassword(operatorId: string, callsign: string) {
    if (!session) return;
    const newPassword = window.prompt(`New password for ${callsign} (min 8 characters):`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      setActionMessage('Password too short — needs at least 8 characters. Nothing changed.');
      return;
    }
    try {
      await kIdAdminApi.resetOperatorPassword(session.accessToken, operatorId, newPassword);
      setActionMessage(`Password reset for ${callsign}. Their sessions were revoked — they'll need to log in again.`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Password reset failed.');
    }
  }

  if (!session || role !== 'ADMIN') return null;

  return (
    <div className="relative h-screen w-screen flex flex-col bg-void">
      <BackgroundColumns scoped />
      <main className="relative flex-1 min-h-0 p-4 flex flex-col gap-4 overflow-y-auto">
        <header className="relative bg-void flex items-center justify-between px-3 py-2.5 border-b-2 border-danger shrink-0">
          <h1 className="font-display text-sm tracking-[0.25em] text-danger uppercase">
            K-APEX-08 <span className="text-ash font-medium">{'//'} Admin Panel</span>
          </h1>
          <a
            href="/console"
            onClick={() => playSound('nav')}
            onMouseEnter={() => playSound('hover')}
            className="bg-void border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2.5 py-1 transition-colors"
          >
            Back to console
          </a>
        </header>

        {actionMessage && (
          <div className="panel-border bg-panel px-3 py-2 text-xs text-warn shrink-0">{actionMessage}</div>
        )}

        <Panel title="Create operator" className="shrink-0">
          <CreateOperatorForm
            accessToken={session.accessToken}
            onCreated={() => {
              setActionMessage('Operator created.');
              void loadOperators();
            }}
          />
        </Panel>

        <Panel title="Operators" className="flex-1 min-h-0">
          <div className="p-3 h-full overflow-y-auto text-xs">
            {listError && <p className="text-warn mb-3">{listError}</p>}
            {!listError && !operators && <p className="text-ash">Loading…</p>}
            {operators && operators.length === 0 && <p className="text-ash">No operators found.</p>}
            {operators && operators.length > 0 && (
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="border-b border-grid text-ash uppercase tracking-wider">
                    <th className="py-1 pr-3">Callsign</th>
                    <th className="py-1 pr-3">Email</th>
                    <th className="py-1 pr-3">Role</th>
                    <th className="py-1 pr-3">TOTP</th>
                    <th className="py-1 pr-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.map((op) => (
                    <tr key={op.id} className="border-b border-grid/50 text-ash-bright hover:bg-grid/20 transition-colors">
                      <td className="py-1.5 pr-3">{op.callsign}</td>
                      <td className="py-1.5 pr-3">{op.email}</td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={`border px-1.5 py-0.5 text-[10px] ${
                            op.role === 'ADMIN' ? 'border-danger text-danger' : 'border-ash text-ash'
                          }`}
                        >
                          {op.role}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        {op.role === 'ADMIN' ? (op.totpEnabled ? 'yes' : 'pending') : '—'}
                      </td>
                      <td className="py-1.5 pr-3 flex gap-2">
                        <button
                          onClick={() => {
                            playSound('select');
                            handleResetPassword(op.id, op.callsign);
                          }}
                          onMouseEnter={() => playSound('hover')}
                          className="border border-signal text-signal px-2 py-0.5 hover:bg-signal hover:text-void transition-colors"
                        >
                          Reset password
                        </button>
                        <button
                          onClick={() => {
                            playSound('select');
                            setPermissionsFor({ id: op.id, callsign: op.callsign });
                          }}
                          onMouseEnter={() => playSound('hover')}
                          className="border border-ash text-ash px-2 py-0.5 hover:border-ash-bright hover:text-ash-bright transition-colors"
                        >
                          Permissions
                        </button>
                        <button
                          onClick={() => {
                            playSound('select');
                            handleRevoke(op.id);
                          }}
                          onMouseEnter={() => playSound('hover')}
                          className="border border-warn text-warn px-2 py-0.5 hover:bg-warn hover:text-void transition-colors"
                        >
                          Revoke
                        </button>
                        <button
                          onClick={() => {
                            playSound('select');
                            handleDelete(op.id);
                          }}
                          onMouseEnter={() => playSound('hover')}
                          className="border border-danger text-danger px-2 py-0.5 hover:bg-danger hover:text-void transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </main>

      {permissionsFor && (
        <OperatorPermissionsModal
          accessToken={session.accessToken}
          operatorId={permissionsFor.id}
          operatorCallsign={permissionsFor.callsign}
          onClose={() => setPermissionsFor(null)}
        />
      )}
    </div>
  );
}

function CreateOperatorForm({
  accessToken,
  onCreated,
}: {
  accessToken: string;
  onCreated: () => void;
}) {
  const [callsign, setCallsign] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('OPERATOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ totpKeyUri: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    playSound('select');
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const created = await kIdApi.registerOperator(accessToken, { callsign, email, password, role });
      setResult({ totpKeyUri: created.totpKeyUri });
      setCallsign('');
      setEmail('');
      setPassword('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create operator.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 flex flex-wrap items-end gap-3 text-xs">
      <Field label="Callsign" value={callsign} onChange={setCallsign} />
      <Field label="Email" value={email} onChange={setEmail} type="email" />
      <Field label="Password" value={password} onChange={setPassword} type="password" />
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-ash tracking-widest uppercase">Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          className="bg-void panel-border px-2 py-1.5 text-ash-bright outline-none focus:border-signal"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy}
        onMouseEnter={() => playSound('hover')}
        className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 py-1.5 hover:bg-signal hover:text-void transition-colors disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create'}
      </button>
      {error && <p className="text-danger w-full">{error}</p>}
      {result && (
        <p className="text-signal w-full break-all">
          Operator created. TOTP key URI (share with them once, it won&apos;t be shown again):{' '}
          {result.totpKeyUri}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-ash tracking-widest uppercase">{label}</span>
      <input
        className="bg-void panel-border px-2 py-1.5 text-ash-bright outline-none focus:border-signal"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </label>
  );
}


