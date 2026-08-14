import { transitionRogueAi, initialExpectedCommand } from './rogue-ai-state-machine.util';

const STEP_WINDOW_MS = 15_000;

describe('transitionRogueAi', () => {
  it('advances DETECTED -> CONTAINED_STEP_1 on correct ISOLATE within window', () => {
    const result = transitionRogueAi({
      state: 'DETECTED',
      expectedNextCommand: 'ISOLATE',
      stepDeadlineMs: 10_000,
      event: { type: 'COMMAND_ISSUED', command: 'ISOLATE', nowMs: 5000 },
      stepWindowMs: STEP_WINDOW_MS,
    });
    expect(result.outcome).toBe('ADVANCED');
    expect(result.nextState).toBe('CONTAINED_STEP_1');
    expect(result.nextExpectedCommand).toBe('TRACE');
    expect(result.nextDeadlineMs).toBe(5000 + STEP_WINDOW_MS);
  });

  it('walks the full happy path to NEUTRALIZED', () => {
    let state: 'DETECTED' | 'CONTAINED_STEP_1' | 'CONTAINED_STEP_2' = 'DETECTED';
    let expected = initialExpectedCommand();
    let deadline = 15_000;
    const commands = ['ISOLATE', 'TRACE', 'PURGE'] as const;
    let lastOutcome = '';

    for (const [i, command] of commands.entries()) {
      const now = i * 1000;
      const result = transitionRogueAi({
        state,
        expectedNextCommand: expected,
        stepDeadlineMs: deadline,
        event: { type: 'COMMAND_ISSUED', command, nowMs: now },
        stepWindowMs: STEP_WINDOW_MS,
      });
      lastOutcome = result.outcome;
      state = result.nextState as never;
      expected = result.nextExpectedCommand as never;
      deadline = result.nextDeadlineMs as never;
    }

    expect(lastOutcome).toBe('NEUTRALIZED');
    expect(state).toBe('NEUTRALIZED');
  });

  it('escalates (does not spread) on a wrong-but-timely command', () => {
    const result = transitionRogueAi({
      state: 'DETECTED',
      expectedNextCommand: 'ISOLATE',
      stepDeadlineMs: 10_000,
      event: { type: 'COMMAND_ISSUED', command: 'PURGE', nowMs: 5000 },
      stepWindowMs: STEP_WINDOW_MS,
    });
    expect(result.outcome).toBe('WRONG_COMMAND');
    expect(result.nextState).toBe('ESCALATED');
  });

  it('spreads on explicit deadline expiry event', () => {
    const result = transitionRogueAi({
      state: 'CONTAINED_STEP_1',
      expectedNextCommand: 'TRACE',
      stepDeadlineMs: 10_000,
      event: { type: 'DEADLINE_EXPIRED' },
      stepWindowMs: STEP_WINDOW_MS,
    });
    expect(result.outcome).toBe('DEADLINE_EXPIRED');
    expect(result.nextState).toBe('SPREAD');
  });

  it('spreads when a correct command arrives after its deadline', () => {
    const result = transitionRogueAi({
      state: 'DETECTED',
      expectedNextCommand: 'ISOLATE',
      stepDeadlineMs: 10_000,
      event: { type: 'COMMAND_ISSUED', command: 'ISOLATE', nowMs: 10_001 },
      stepWindowMs: STEP_WINDOW_MS,
    });
    expect(result.outcome).toBe('DEADLINE_EXPIRED');
    expect(result.nextState).toBe('SPREAD');
  });

  it('accepts a command arriving exactly at the deadline boundary', () => {
    const result = transitionRogueAi({
      state: 'DETECTED',
      expectedNextCommand: 'ISOLATE',
      stepDeadlineMs: 10_000,
      event: { type: 'COMMAND_ISSUED', command: 'ISOLATE', nowMs: 10_000 },
      stepWindowMs: STEP_WINDOW_MS,
    });
    expect(result.outcome).toBe('ADVANCED');
  });

  it.each(['NEUTRALIZED', 'ESCALATED', 'SPREAD'] as const)('ignores further events once terminal (%s)', (state) => {
    const result = transitionRogueAi({
      state,
      expectedNextCommand: null,
      stepDeadlineMs: null,
      event: { type: 'COMMAND_ISSUED', command: 'PURGE', nowMs: 99_999 },
      stepWindowMs: STEP_WINDOW_MS,
    });
    expect(result.outcome).toBe('IGNORED');
    expect(result.nextState).toBe(state);
  });

  it('initialExpectedCommand is ISOLATE', () => {
    expect(initialExpectedCommand()).toBe('ISOLATE');
  });
});
