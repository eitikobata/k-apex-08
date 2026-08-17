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
};
