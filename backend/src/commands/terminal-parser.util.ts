/**
 * Parses raw terminal input (typed into xterm.js on the frontend) into the
 * same normalized command shape the UI's buttons send directly. Pure, no
 * I/O — CommandService is the only thing that knows how to actually run
 * a NormalizedCommand.
 *
 * Grammar:
 *   CONFIRM [<anything>] //<incidentId>   (the word between CONFIRM and the
 *                                          target, if any, is never checked —
 *                                          CONFIRM_KURO_ICE_ACTION only ever
 *                                          carries {incidentId}; CommandService
 *                                          looks the real tier up from the DB
 *                                          itself. This is deliberately lenient
 *                                          so different incident tiers can ask
 *                                          for different amounts of typed
 *                                          friction on the frontend — "CONFIRM
 *                                          //<id>", "CONFIRM SPLICE //<id>",
 *                                          and "CONFIRM SHATTER //<id>" all do
 *                                          the exact same thing here.)
 *   ISOLATE //<rogueAiIncidentId>
 *   TRACE //<rogueAiIncidentId>
 *   PURGE //<rogueAiIncidentId> --confirm
 *   AUTONOMOUS ON
 *   AUTONOMOUS OFF
 */
export type NormalizedCommand =
  | { type: 'CONFIRM_KURO_ICE_ACTION'; incidentId: string }
  | { type: 'ROGUE_AI_COMMAND'; rogueAiIncidentId: string; command: 'ISOLATE' | 'TRACE' | 'PURGE' }
  | { type: 'AUTONOMOUS_TOGGLE'; active: boolean };

export interface ParseResult {
  ok: boolean;
  command?: NormalizedCommand;
  error?: string;
}

function extractTarget(raw: string): string | null {
  const match = raw.match(/\/\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

export function parseTerminalCommand(rawInput: string): ParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: 'Empty command' };

  const tokens = trimmed.split(/\s+/);
  const verb = tokens[0].toUpperCase();

  if (verb === 'CONFIRM') {
    const target = extractTarget(trimmed);
    if (!target) return { ok: false, error: 'Missing //<incidentId> target' };
    return { ok: true, command: { type: 'CONFIRM_KURO_ICE_ACTION', incidentId: target } };
  }

  if (verb === 'ISOLATE' || verb === 'TRACE' || verb === 'PURGE') {
    const target = extractTarget(trimmed);
    if (!target) return { ok: false, error: 'Missing //<rogueAiIncidentId> target' };
    if (verb === 'PURGE' && !trimmed.includes('--confirm')) {
      return { ok: false, error: 'PURGE requires the --confirm flag — this step is irreversible' };
    }
    return { ok: true, command: { type: 'ROGUE_AI_COMMAND', rogueAiIncidentId: target, command: verb } };
  }

  if (verb === 'AUTONOMOUS') {
    const arg = tokens[1]?.toUpperCase();
    if (arg !== 'ON' && arg !== 'OFF') {
      return { ok: false, error: 'AUTONOMOUS requires ON or OFF' };
    }
    return { ok: true, command: { type: 'AUTONOMOUS_TOGGLE', active: arg === 'ON' } };
  }

  return { ok: false, error: `Unrecognized command: ${verb}` };
}
