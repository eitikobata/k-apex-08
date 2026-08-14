/**
 * Rogue-AI containment state machine. Pure — no clock reads, no I/O.
 *
 * Sequence: ISOLATE -> TRACE -> PURGE, one command per step, each with its
 * own time window. Two distinct failure modes, on purpose:
 *  - Wrong command (right timing, wrong choice) -> ESCALATED. The operator
 *    is engaged but fumbled; KURO-ICE responds harsher on the same node.
 *  - Deadline expired (no command in time) -> SPREAD. Nobody answered in
 *    time; the incursion propagates to a neighboring node.
 * Same "wrong action" concept, deliberately different consequence, matching
 * the brief's intent that hesitation is worse than a wrong guess.
 */
export type RogueAiState =
  | 'DETECTED'
  | 'CONTAINED_STEP_1'
  | 'CONTAINED_STEP_2'
  | 'NEUTRALIZED'
  | 'ESCALATED'
  | 'SPREAD';

export type RogueAiCommand = 'ISOLATE' | 'TRACE' | 'PURGE';

const COMMAND_SEQUENCE: RogueAiCommand[] = ['ISOLATE', 'TRACE', 'PURGE'];
const STATE_AFTER_STEP: RogueAiState[] = ['CONTAINED_STEP_1', 'CONTAINED_STEP_2', 'NEUTRALIZED'];

const TERMINAL_STATES: RogueAiState[] = ['NEUTRALIZED', 'ESCALATED', 'SPREAD'];

export type RogueAiEvent =
  | { type: 'COMMAND_ISSUED'; command: RogueAiCommand; nowMs: number }
  | { type: 'DEADLINE_EXPIRED' };

export interface RogueAiTransitionInput {
  state: RogueAiState;
  expectedNextCommand: RogueAiCommand | null;
  stepDeadlineMs: number | null;
  event: RogueAiEvent;
  stepWindowMs: number;
}

export type RogueAiOutcome = 'ADVANCED' | 'NEUTRALIZED' | 'WRONG_COMMAND' | 'DEADLINE_EXPIRED' | 'IGNORED';

export interface RogueAiTransitionOutput {
  nextState: RogueAiState;
  nextExpectedCommand: RogueAiCommand | null;
  nextDeadlineMs: number | null;
  outcome: RogueAiOutcome;
}

export function transitionRogueAi(input: RogueAiTransitionInput): RogueAiTransitionOutput {
  const { state, expectedNextCommand, stepDeadlineMs, event, stepWindowMs } = input;

  if (TERMINAL_STATES.includes(state)) {
    return { nextState: state, nextExpectedCommand: null, nextDeadlineMs: null, outcome: 'IGNORED' };
  }

  if (event.type === 'DEADLINE_EXPIRED') {
    return { nextState: 'SPREAD', nextExpectedCommand: null, nextDeadlineMs: null, outcome: 'DEADLINE_EXPIRED' };
  }

  // COMMAND_ISSUED
  if (stepDeadlineMs !== null && event.nowMs > stepDeadlineMs) {
    return { nextState: 'SPREAD', nextExpectedCommand: null, nextDeadlineMs: null, outcome: 'DEADLINE_EXPIRED' };
  }

  if (event.command !== expectedNextCommand) {
    return { nextState: 'ESCALATED', nextExpectedCommand: null, nextDeadlineMs: null, outcome: 'WRONG_COMMAND' };
  }

  const stepIndex = COMMAND_SEQUENCE.indexOf(event.command);
  const nextState = STATE_AFTER_STEP[stepIndex];

  if (nextState === 'NEUTRALIZED') {
    return { nextState, nextExpectedCommand: null, nextDeadlineMs: null, outcome: 'NEUTRALIZED' };
  }

  const nextExpectedCommand = COMMAND_SEQUENCE[stepIndex + 1];
  return {
    nextState,
    nextExpectedCommand,
    nextDeadlineMs: event.nowMs + stepWindowMs,
    outcome: 'ADVANCED',
  };
}

export function initialExpectedCommand(): RogueAiCommand {
  return COMMAND_SEQUENCE[0];
}
