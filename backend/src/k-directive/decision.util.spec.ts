import { decideIncidentHandling } from './decision.util';

describe('decideIncidentHandling', () => {
  it('LATCH requires operator when autonomous mode is off (used to always self-resolve — that meant LATCH never reached the operator at all)', () => {
    expect(decideIncidentHandling('LATCH', false)).toEqual({
      requiresOperator: true,
      actionType: 'FLAG_ONLY',
      autonomous: false,
    });
  });

  it('LATCH self-resolves when autonomous mode is on', () => {
    expect(decideIncidentHandling('LATCH', true)).toEqual({
      requiresOperator: false,
      actionType: 'FLAG_ONLY',
      autonomous: true,
    });
  });

  it('SPLICE requires operator when autonomous mode is off', () => {
    expect(decideIncidentHandling('SPLICE', false)).toEqual({
      requiresOperator: true,
      actionType: 'BLOCK_TRAFFIC',
      autonomous: false,
    });
  });

  it('SPLICE self-resolves when autonomous mode is on', () => {
    expect(decideIncidentHandling('SPLICE', true)).toEqual({
      requiresOperator: false,
      actionType: 'BLOCK_TRAFFIC',
      autonomous: true,
    });
  });

  it('SHATTER requires operator when autonomous mode is off', () => {
    expect(decideIncidentHandling('SHATTER', false)).toEqual({
      requiresOperator: true,
      actionType: 'ISOLATE_NODE',
      autonomous: false,
    });
  });

  it('SHATTER self-resolves (isolates node) when autonomous mode is on', () => {
    expect(decideIncidentHandling('SHATTER', true)).toEqual({
      requiresOperator: false,
      actionType: 'ISOLATE_NODE',
      autonomous: true,
    });
  });
});
