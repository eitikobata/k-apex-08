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
    expect(parseTerminalCommand('AUTONOMOUS ON').command).toEqual({ type: 'AUTONOMOUS_TOGGLE', active: true });
    expect(parseTerminalCommand('AUTONOMOUS OFF').command).toEqual({ type: 'AUTONOMOUS_TOGGLE', active: false });
  });

  it('rejects AUTONOMOUS with an invalid argument', () => {
    expect(parseTerminalCommand('AUTONOMOUS MAYBE').ok).toBe(false);
  });

  it('rejects empty input', () => {
    expect(parseTerminalCommand('   ').ok).toBe(false);
  });

  it('rejects unrecognized verbs', () => {
    const result = parseTerminalCommand('DANCE //node-1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unrecognized/);
  });
});
