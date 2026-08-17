/**
 * Central list of granular permission scopes. ADMIN bypasses all of these
 * by design (see PermissionsService) — this layer only matters for
 * SENIOR_OPERATOR / OPERATOR, where role alone isn't a fine enough
 * distinction (e.g. "operator who can approve SHATTER" vs "operator who
 * can't yet").
 */
export const PERMISSION_SCOPES = {
  APPROVE_SHATTER: 'kuro_ice:approve_shatter',
  APPROVE_SPLICE: 'kuro_ice:approve_splice',
  TOGGLE_AUTONOMOUS: 'k_directive:toggle_autonomous',
  ROGUE_AI_COMMAND: 'rogue_ai:issue_command',
} as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[keyof typeof PERMISSION_SCOPES];
