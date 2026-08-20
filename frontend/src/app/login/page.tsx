'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { kIdApi, ApiError, LoginStep1Result } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { Panel } from '@/components/Panel';

type Stage =
  | { step: 'CREDENTIALS' }
  | { step: 'MFA_REQUIRED'; mfaPendingToken: string }
  | { step: 'MFA_SETUP_REQUIRED'; totpSetupToken: string; totpKeyUri: string };

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [stage, setStage] = useState<Stage>({ step: 'CREDENTIALS' });
  const [callsign, setCallsign] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Demo/observer autofill — reads from env, not hardcoded, so nothing
  // sensitive lives in source. Only renders when NEXT_PUBLIC_DEMO_CALLSIGN
  // is actually set at build time (set it in the deploy env when there's a
  // demo account to point recruiters at; leave unset otherwise and this
  // button just doesn't exist). Fills the fields, doesn't auto-submit —
  // still a real click to authenticate.
  const demoCallsign = process.env.NEXT_PUBLIC_DEMO_CALLSIGN;
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
  function fillDemoCredentials() {
    if (!demoCallsign || !demoPassword) return;
    setCallsign(demoCallsign);
    setPassword(demoPassword);
  }

  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result: LoginStep1Result = await kIdApi.login(callsign, password);
      if (result.status === 'MFA_REQUIRED') {
        setStage({ step: 'MFA_REQUIRED', mfaPendingToken: result.mfaPendingToken });
      } else {
        setStage({
          step: 'MFA_SETUP_REQUIRED',
          totpSetupToken: result.totpSetupToken,
          totpKeyUri: result.totpKeyUri,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connection to K-APEX-08 failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const pair =
        stage.step === 'MFA_REQUIRED'
          ? await kIdApi.completeLoginWithTotp(stage.mfaPendingToken, totpCode)
          : stage.step === 'MFA_SETUP_REQUIRED'
            ? await kIdApi.completeTotpSetup(stage.totpSetupToken, totpCode)
            : null;
      if (!pair) return;
      setSession(pair);
      router.push('/console');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connection to K-APEX-08 failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="h-screen w-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1
            className="glitch-text font-display text-2xl tracking-[0.3em] text-ash-bright uppercase"
            data-text="K-APEX-08"
          >
            K-APEX-08
          </h1>
          <p className="text-xs text-ash tracking-widest mt-1 uppercase">Kobata Matrix Corporation</p>
        </div>

        <Panel title="Operator authentication">
          <div className="p-4">
            {stage.step === 'CREDENTIALS' && (
              <form onSubmit={handleCredentialsSubmit} className="flex flex-col gap-3">
                <Field label="Callsign" value={callsign} onChange={setCallsign} autoFocus />
                <Field label="Password" value={password} onChange={setPassword} type="password" />
                {error && <ErrorText>{error}</ErrorText>}
                <SubmitButton busy={busy}>Authenticate</SubmitButton>
                {demoCallsign && demoPassword && (
                  <button
                    type="button"
                    onClick={fillDemoCredentials}
                    className="text-ash hover:text-ash-bright text-[10px] tracking-widest uppercase underline underline-offset-2"
                  >
                    Fill demo credentials
                  </button>
                )}
              </form>
            )}

            {stage.step === 'MFA_REQUIRED' && (
              <form onSubmit={handleTotpSubmit} className="flex flex-col gap-3">
                <p className="text-xs text-ash">Enter the 6-digit code from your authenticator.</p>
                <Field label="TOTP code" value={totpCode} onChange={setTotpCode} autoFocus maxLength={6} />
                {error && <ErrorText>{error}</ErrorText>}
                <SubmitButton busy={busy}>Confirm</SubmitButton>
              </form>
            )}

            {stage.step === 'MFA_SETUP_REQUIRED' && (
              <form onSubmit={handleTotpSubmit} className="flex flex-col gap-3">
                <p className="text-xs text-ash">
                  First login — enroll an authenticator. Add this key manually, then confirm with the
                  code it generates.
                </p>
                <div className="bg-void panel-border p-2 text-[10px] text-signal break-all select-all">
                  {stage.totpKeyUri}
                </div>
                <Field label="TOTP code" value={totpCode} onChange={setTotpCode} autoFocus maxLength={6} />
                {error && <ErrorText>{error}</ErrorText>}
                <SubmitButton busy={busy}>Enroll &amp; sign in</SubmitButton>
              </form>
            )}
          </div>
        </Panel>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoFocus,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-ash tracking-widest uppercase">{label}</span>
      <input
        className="bg-void panel-border px-2 py-1.5 text-sm text-ash-bright outline-none focus:border-signal"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        maxLength={maxLength}
        required
      />
    </label>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-danger">{children}</p>;
}

function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-1 bg-signal-dim border border-signal text-signal font-display tracking-widest uppercase text-xs py-2 hover:bg-signal hover:text-void transition-colors disabled:opacity-50"
    >
      {busy ? 'Connecting…' : children}
    </button>
  );
}
