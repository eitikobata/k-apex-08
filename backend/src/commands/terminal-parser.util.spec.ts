import { parseTerminalCommand } from './terminal-parser.util';

describe('parseTerminalCommand', () => {
  it('parses CONFIRM SHATTER with a target', () => {
    const result = parseTerminalCommand('CONFIRM SHATTER //inc-123');
    expect(result.ok).toBe(true);
    expect(result.command).toEqual({ type: 'CONFIRM_KURO_ICE_ACTION', incidentId: 'inc-123' });
  });

  it('parses CONFIRM SPLICE case-insensitively', () => {
    const result = parseTerminalCommand('confirm splice //inc-abc');
    expect(result.ok).toBe(true);
    expect(result.command).toEqual({ type: 'CONFIRM_KURO_ICE_ACTION', incidentId: 'inc-abc' });
  });

  it('rejects CONFIRM with an invalid tier', () => {
    const result = parseTerminalCommand('CONFIRM LATCH //inc-123');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SHATTER or SPLICE/);
  });

  it('rejects CONFIRM without a target', () => {
    const result = parseTerminalCommand('CONFIRM SHATTER');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Missing //<incidentId> target');
  });

  it('rejects a bare CONFIRM with no further tokens', () => {
    // Regression guard: tokens[1] is undefined here — must not throw.
    const result = parseTerminalCommand('CONFIRM');
    expect(result.ok).toBe(false);
  });

  it('parses ISOLATE and TRACE for rogue AI without requiring --confirm', () => {
    expect(parseTerminalCommand('ISOLATE //rai-1').command).toEqual({
      type: 'ROGUE_AI_COMMAND',
      rogueAiIncidentId: 'rai-1',
      command: 'ISOLATE',
    });
    expect(parseTerminalCommand('TRACE //rai-1').command).toEqual({
      type: 'ROGUE_AI_COMMAND',
      rogueAiIncidentId: 'rai-1',
      command: 'TRACE',
    });
  });

  it('rejects ISOLATE without a target', () => {
    const result = parseTerminalCommand('ISOLATE');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Missing //<rogueAiIncidentId> target');
  });

  it('requires --confirm for PURGE', () => {
    const withoutConfirm = parseTerminalCommand('PURGE //rai-1');
    expect(withoutConfirm.ok).toBe(false);
    expect(withoutConfirm.error).toMatch(/--confirm/);

    const withConfirm = parseTerminalCommand('PURGE //rai-1 --confirm');
    expect(withConfirm.ok).toBe(true);
    expect(withConfirm.command).toEqual({
      type: 'ROGUE_AI_COMMAND',
      rogueAiIncidentId: 'rai-1',
      command: 'PURGE',
    });
  });

  it('parses AUTONOMOUS ON and OFF', () => {
    const on = parseTerminalCommand('AUTONOMOUS ON');
    expect(on.ok).toBe(true);
    expect(on.command).toEqual({ type: 'AUTONOMOUS_TOGGLE', active: true });

    const off = parseTerminalCommand('AUTONOMOUS OFF');
    expect(off.ok).toBe(true);
    expect(off.command).toEqual({ type: 'AUTONOMOUS_TOGGLE', active: false });
  });

  it('rejects AUTONOMOUS with an invalid argument', () => {
    const result = parseTerminalCommand('AUTONOMOUS MAYBE');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('AUTONOMOUS requires ON or OFF');
  });

  it('rejects a bare AUTONOMOUS with no further tokens', () => {
    const result = parseTerminalCommand('AUTONOMOUS');
    expect(result.ok).toBe(false);
  });

  it('rejects empty input with the exact reason (not a fallthrough "unrecognized" error)', () => {
    const result = parseTerminalCommand('   ');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Empty command');
  });

  it('rejects unrecognized verbs', () => {
    const result = parseTerminalCommand('DANCE //node-1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unrecognized/);
  });

  it('collapses consecutive whitespace between tokens', () => {
    const result = parseTerminalCommand('CONFIRM   SHATTER    //inc-123');
    expect(result.ok).toBe(true);
    expect(result.command).toEqual({ type: 'CONFIRM_KURO_ICE_ACTION', incidentId: 'inc-123' });
  });
});
