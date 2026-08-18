import { io, Socket } from 'socket.io-client';

// Strips any trailing slash — a raw '/' at the end plus the '/console'
// suffix below produced a literal '//console' namespace, which the
// backend's socket.io rejected as invalid. Defensive regardless of what's
// actually in the env var.
const WS_URL = (process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

// Mirrors src/commands/terminal-parser.util.ts on the backend exactly —
// this is the single command shape both the terminal parser and UI
// buttons produce, so the frontend must speak the same shape.
export type NormalizedCommand =
  | { type: 'CONFIRM_KURO_ICE_ACTION'; incidentId: string }
  | { type: 'ROGUE_AI_COMMAND'; rogueAiIncidentId: string; command: 'ISOLATE' | 'TRACE' | 'PURGE' }
  | { type: 'AUTONOMOUS_TOGGLE'; active: boolean };

export interface CommandResultPayload {
  command: NormalizedCommand;
  result: Record<string, unknown>;
}

export interface CommandErrorPayload {
  message: string;
  command?: NormalizedCommand;
}

export interface IncidentAwaitingOperatorPayload {
  incidentId: string;
  tier: 'LATCH' | 'SPLICE' | 'SHATTER';
  rogueAi?: boolean;
  rogueAiIncidentId?: string;
}

export interface AutonomousModeChangedPayload {
  active: boolean;
  origin: 'AUTO_TIMEOUT' | 'MANUAL_TOGGLE_AUTONOMOUS';
}

export interface RogueAiTransitionPayload {
  rogueAiIncidentId: string;
  outcome: 'ADVANCED' | 'NEUTRALIZED' | 'WRONG_COMMAND' | 'DEADLINE_EXPIRED' | 'IGNORED';
  nextState: string;
}

export interface RogueAiResolvedAutonomouslyPayload {
  rogueAiIncidentId: string;
  nodeId: string;
}

export function createConsoleSocket(accessToken: string): Socket {
  return io(`${WS_URL}/console`, {
    auth: { token: accessToken },
    autoConnect: false,
  });
}

/** Sends a raw terminal-typed line — the backend's own parser normalizes it. */
export function sendRawCommand(socket: Socket, raw: string): void {
  socket.emit('command', { raw });
}

/** Sends an already-normalized command — what a UI button click produces. */
export function sendNormalizedCommand(socket: Socket, normalized: NormalizedCommand): void {
  socket.emit('command', { normalized });
}
