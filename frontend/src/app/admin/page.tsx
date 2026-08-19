'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { kIdApi, kIdAdminApi, kStreamApi, ApiError, OperatorSummaryDto } from '@/lib/api-client';
import { Panel } from '@/components/Panel';

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
      setListError(
        err instanceof ApiError && err.status === 404
          ? 'Backend endpoint not deployed yet — this list will populate once GET /k-id/operators exists.'
          : err instanceof Error
            ? err.message
            : 'Failed to load operators.',
      );
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
      setActionMessage(
        err instanceof ApiError && err.status === 404
          ? 'Backend endpoint not deployed yet.'
          : err instanceof Error
            ? err.message
            : 'Revoke failed.',
      );
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
      setActionMessage(
        err instanceof ApiError && err.status === 404
          ? 'Backend endpoint not deployed yet.'
          : err instanceof Error
            ? err.message
            : 'Delete failed.',
      );
    }
  }

  if (!session || role !== 'ADMIN') return null;

  return (
    <main className="h-screen w-screen p-3 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-sm tracking-[0.3em] text-ash-bright uppercase">
          K-APEX-08 <span className="text-ash">{'//'} Admin panel</span>
        </h1>
        <a
          href="/console"
          className="border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2 py-1 transition-colors"
        >
          Back to console
        </a>
      </header>

      {actionMessage && (
        <div className="panel-border bg-panel/80 px-3 py-2 text-xs text-warn">{actionMessage}</div>
      )}

      <Panel title="Debug: force incident" className="shrink-0">
        <DebugInjectPanel accessToken={session.accessToken} onInjected={setActionMessage} />
      </Panel>

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
                  <th className="py-1 pr-3">MFA exempt</th>
                  <th className="py-1 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((op) => (
                  <tr key={op.id} className="border-b border-grid/50 text-ash-bright">
                    <td className="py-1.5 pr-3">{op.callsign}</td>
                    <td className="py-1.5 pr-3">{op.email}</td>
                    <td className="py-1.5 pr-3">{op.role}</td>
                    <td className="py-1.5 pr-3">{op.totpEnabled ? 'yes' : 'no'}</td>
                    <td className="py-1.5 pr-3">{op.mfaExempt ? 'yes' : 'no'}</td>
                    <td className="py-1.5 pr-3 flex gap-2">
                      <button
                        onClick={() => handleRevoke(op.id)}
                        className="border border-warn text-warn px-2 py-0.5 hover:bg-warn hover:text-void transition-colors"
                      >
                        Revoke
                      </button>
                      <button
                        onClick={() => handleDelete(op.id)}
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

const DEBUG_TYPES = ['LATCH', 'SPLICE', 'SHATTER', 'ROGUE_AI'] as const;

// Testing utility only — the button, the endpoint it calls, and the whole
// point of it is speed: SimulatorService's ambient odds (even bumped up)
// still can't guarantee "an incident right now" for a specific tier. This
// forces one in on demand, through the same pipeline a real detection
// uses (see KStreamService.debugInjectIncident) — operator notification,
// autonomous-mode handling, and Rogue AI containment all behave exactly
// like an organic incident once it lands.
function DebugInjectPanel({
  accessToken,
  onInjected,
}: {
  accessToken: string;
  onInjected: (message: string) => void;
}) {
  const [busyType, setBusyType] = useState<(typeof DEBUG_TYPES)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inject(type: (typeof DEBUG_TYPES)[number]) {
    setBusyType(type);
    setError(null);
    try {
      const result = await kStreamApi.debugInject(accessToken, type);
      onInjected(`Injected ${type} incident — #${result.incidentId.slice(0, 8)}…`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to inject ${type} incident.`);
    } finally {
      setBusyType(null);
    }
  }

  return (
    <div className="p-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ash mr-1">Force an incident (skips waiting on the simulator):</span>
      {DEBUG_TYPES.map((type) => (
        <button
          key={type}
          onClick={() => void inject(type)}
          disabled={busyType !== null}
          className={`border font-display tracking-widest uppercase text-[10px] px-3 py-1.5 transition-colors disabled:opacity-40 ${
            type === 'SHATTER' || type === 'ROGUE_AI'
              ? 'border-danger text-danger hover:bg-danger hover:text-void'
              : type === 'SPLICE'
                ? 'border-warn text-warn hover:bg-warn hover:text-void'
                : 'border-signal text-signal hover:bg-signal hover:text-void'
          }`}
        >
          {busyType === type ? 'Working…' : type.replace('_', ' ')}
        </button>
      ))}
      {error && <p className="text-danger w-full">{error}</p>}
    </div>
  );
}
