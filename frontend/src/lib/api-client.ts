const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(body.message ?? 'Request failed', response.status);
  }

  return response.json() as Promise<T>;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

// --- K-ID -------------------------------------------------------------

export type LoginStep1Result =
  | { status: 'MFA_REQUIRED'; mfaPendingToken: string }
  | { status: 'MFA_SETUP_REQUIRED'; totpSetupToken: string; totpKeyUri: string };

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export const kIdApi = {
  login: (callsign: string, password: string) =>
    request<LoginStep1Result>('/k-id/login', {
      method: 'POST',
      body: JSON.stringify({ callsign, password }),
    }),

  completeLoginWithTotp: (mfaPendingToken: string, totpCode: string) =>
    request<IssuedTokenPair>('/k-id/login/totp', {
      method: 'POST',
      body: JSON.stringify({ mfaPendingToken, totpCode }),
    }),

  completeTotpSetup: (totpSetupToken: string, totpCode: string) =>
    request<IssuedTokenPair>('/k-id/totp/setup-confirm', {
      method: 'POST',
      body: JSON.stringify({ totpSetupToken, totpCode }),
    }),

  refresh: (refreshToken: string) =>
    request<IssuedTokenPair>('/k-id/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (accessToken: string) =>
    request<{ status: string }>('/k-id/logout', {
      method: 'POST',
      headers: authHeaders(accessToken),
    }),

  registerOperator: (
    accessToken: string,
    dto: { callsign: string; email: string; password: string; role: string },
  ) =>
    request<{ operatorId: string; totpKeyUri: string }>('/k-id/operators', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(dto),
    }),

  changePassword: (accessToken: string, currentPassword: string, newPassword: string) =>
    request<{ status: string }>('/k-id/password', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Both endpoints are real (see KIdController) — they just weren't wired
  // into the frontend yet. Response types come from @simplewebauthn/types
  // on the backend; kept loose here (unknown) since the frontend only ever
  // passes them straight through to @simplewebauthn/browser, never inspects
  // the shape itself.
  webauthnRegistrationOptions: (accessToken: string) =>
    request<Record<string, unknown>>('/k-id/webauthn/registration-options', {
      method: 'POST',
      headers: authHeaders(accessToken),
    }),

  webauthnRegistrationVerify: (accessToken: string, response: unknown, deviceLabel?: string) =>
    request<{ verified: boolean }>('/k-id/webauthn/registration-verify', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ response, deviceLabel }),
    }),

  // Real endpoint (KIdController) — deliberately minimal (callsign + role
  // only), matching what was agreed. The access token itself only ever
  // carried {sub, role}, which is why AccountMenu used to show a
  // truncated operator id instead of a name.
  me: (accessToken: string) =>
    request<{ callsign: string; role: string }>('/k-id/me', {
      headers: authHeaders(accessToken),
    }),
};

// --- K-ID / Admin operator management ------------------------------------
// NOTE (honesty flag): these three endpoints don't exist on the backend
// yet — listOperators, revokeOperatorSessions, and deleteOperator are all
// planned but not implemented as of this writing. They'll 404 until the
// backend catches up. Written now so the admin page just starts working
// the moment those land, no frontend changes needed.

export interface OperatorSummaryDto {
  id: string;
  callsign: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  mfaExempt: boolean;
  createdAt: string;
}

export const kIdAdminApi = {
  listOperators: (accessToken: string) =>
    request<OperatorSummaryDto[]>('/k-id/operators', {
      headers: authHeaders(accessToken),
    }),

  revokeOperatorSessions: (accessToken: string, operatorId: string) =>
    request<{ status: string }>(`/k-id/operators/${operatorId}/revoke-sessions`, {
      method: 'POST',
      headers: authHeaders(accessToken),
    }),

  deleteOperator: (accessToken: string, operatorId: string) =>
    request<{ status: string }>(`/k-id/operators/${operatorId}`, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    }),

  // Admin resets any operator's password directly — no current-password
  // check server-side (that's the whole point: recovering an account the
  // operator themselves can't log into).
  resetOperatorPassword: (accessToken: string, operatorId: string, newPassword: string) =>
    request<{ status: string }>(`/k-id/operators/${operatorId}/password`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ newPassword }),
    }),
};

// --- K-DIRECTIVE --------------------------------------------------------

export type ResolutionOrigin =
  | 'MANUAL_OPERATOR'
  | 'AUTO_TIMEOUT'
  | 'MANUAL_TOGGLE_AUTONOMOUS'
  | 'AUTO_LOW_SEVERITY'
  | null;

export interface SystemStateDto {
  id: string;
  autonomousModeActive: boolean;
  activatedAt: string | null;
  activatedOrigin: ResolutionOrigin;
  activatedByOperatorId: string | null;
}

export const kDirectiveApi = {
  getAutonomousMode: (accessToken: string) =>
    request<SystemStateDto>('/k-directive/autonomous-mode', {
      headers: authHeaders(accessToken),
    }),

  toggleAutonomousMode: (accessToken: string, active: boolean) =>
    request<{ status: string; active: boolean }>('/k-directive/autonomous-mode/toggle', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ active }),
    }),

  heartbeat: (accessToken: string) =>
    request<{ status: string }>('/k-directive/heartbeat', {
      method: 'POST',
      headers: authHeaders(accessToken),
    }),
};

// --- K-BLACKBOX -----------------------------------------------------------

export interface CaseFileSummaryDto {
  id: string;
  incidentId: string;
  aiSummary: string | null;
  aiSummaryFailed: boolean;
  createdAt: string;
}

export const kBlackboxApi = {
  summarize: (accessToken: string, incidentId: string) =>
    request<{ summary: string | null; skipped?: string }>(
      `/k-blackbox/cases/${incidentId}/summarize`,
      { method: 'POST', headers: authHeaders(accessToken) },
    ),

  replay: (accessToken: string, incidentId: string) =>
    request<unknown[]>(`/k-blackbox/cases/${incidentId}/replay`, {
      headers: authHeaders(accessToken),
    }),

  // NOTE (honesty flag): GET /k-blackbox/cases doesn't exist yet — only
  // summarize and replay are real today (see KBlackboxController). This is
  // written against the natural extension of that controller so BlackboxPanel
  // just starts working the moment it lands, same pattern as kIdAdminApi above.
  listCases: (accessToken: string) =>
    request<CaseFileSummaryDto[]>('/k-blackbox/cases', {
      headers: authHeaders(accessToken),
    }),

  // Real now (KBlackboxController) — embeds the query server-side (same
  // model used for case summaries) and runs it through the existing
  // pgvector similarity search.
  searchByText: (accessToken: string, query: string, limit = 5) =>
    request<{ id: string; incidentId: string; aiSummary: string | null; distance: number }[]>(
      '/k-blackbox/cases/search-by-text',
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ query, limit }),
      },
    ),
};

// --- K-STREAM / incidents --------------------------------------------------
// NOTE (honesty flag): no REST list endpoint exists yet. IncidentsPanel works
// today purely from live INCIDENT_AWAITING_OPERATOR socket events accumulated
// client-side (session-scoped, resets on reload). This function is written
// for when GET /k-stream/incidents lands, to backfill history on page load.
export interface IncidentSummaryDto {
  id: string;
  tier: 'LATCH' | 'SPLICE' | 'SHATTER';
  status: string;
  kind: string;
  summary: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const kStreamApi = {
  listIncidents: (accessToken: string) =>
    request<IncidentSummaryDto[]>('/k-stream/incidents', {
      headers: authHeaders(accessToken),
    }),

  // Real endpoint (KStreamController) — admin-only, forces an incident
  // through the same pipeline a real detection uses. Testing utility, not
  // exposed to non-admin roles server-side either.
  debugInject: (accessToken: string, type: 'LATCH' | 'SPLICE' | 'SHATTER' | 'ROGUE_AI') =>
    request<{ incidentId: string }>('/k-stream/debug/inject', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ type }),
    }),
};

// --- K-SILENCE --------------------------------------------------------------
// NOTE (honesty flag): no REST endpoint exists yet. The 24 nodes and their
// SilenceState already exist in the Prisma schema (NetworkNode, SilenceState)
// but nothing exposes them over HTTP. NodeGrid.tsx calls this and falls back
// to an "awaiting backend" tile state on a 404 instead of faking data.
export interface NodeStatusDto {
  codeName: string; // "NODE-01".."NODE-24"
  sector: number;
  status: 'ALIVE' | 'RETRYING' | 'CONFIRMED_SILENT' | 'RECOVERING' | 'RESOLVED';
  lastHeartbeatAt: string | null;
  attemptCount: number | null; // only set while RETRYING
  maxAttempts: number | null; // only set while RETRYING
  recoverAt: string | null; // only set while RECOVERING
}

export const kSilenceApi = {
  listNodes: (accessToken: string) =>
    request<NodeStatusDto[]>('/k-silence/nodes', {
      headers: authHeaders(accessToken),
    }),
};

// --- K-BLACKTAPE (audit log) -------------------------------------------------
// NOTE (honesty flag): no REST endpoint exists yet. BlacktapeEntry rows are
// already being written by BlacktapeService on the backend (auth events,
// incident resolutions, Rogue AI transitions, etc.) — nothing reads them back
// over HTTP yet. AuditLogPanel.tsx is built against this contract.
export interface BlacktapeEntryDto {
  id: string;
  category: string;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export const kBlacktapeApi = {
  listEntries: (
    accessToken: string,
    params: { category?: string; before?: { createdAt: string; id: string }; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.before) {
      qs.set('beforeCreatedAt', params.before.createdAt);
      qs.set('beforeId', params.before.id);
    }
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<BlacktapeEntryDto[]>(`/k-blacktape/entries${query ? `?${query}` : ''}`, {
      headers: authHeaders(accessToken),
    });
  },
};
