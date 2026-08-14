import { checkAllowRequest, recordOutcome, INITIAL_CIRCUIT_STATE, CircuitBreakerState } from './circuit-breaker.util';

const CONFIG = { failureThreshold: 3, cooldownMs: 30_000 };

describe('circuit breaker', () => {
  it('starts CLOSED and allows requests', () => {
    const result = checkAllowRequest(INITIAL_CIRCUIT_STATE, CONFIG, 0);
    expect(result.allowed).toBe(true);
    expect(result.state.state).toBe('CLOSED');
  });

  it('stays CLOSED on failures below threshold', () => {
    let state = INITIAL_CIRCUIT_STATE;
    state = recordOutcome(state, CONFIG, false, 0);
    state = recordOutcome(state, CONFIG, false, 1);
    expect(state.state).toBe('CLOSED');
    expect(state.consecutiveFailures).toBe(2);
  });

  it('opens exactly at the failure threshold', () => {
    let state = INITIAL_CIRCUIT_STATE;
    state = recordOutcome(state, CONFIG, false, 0);
    state = recordOutcome(state, CONFIG, false, 1);
    state = recordOutcome(state, CONFIG, false, 2);
    expect(state.state).toBe('OPEN');
    expect(state.openedAtMs).toBe(2);
  });

  it('a success resets failures and stays/returns CLOSED', () => {
    let state = recordOutcome(INITIAL_CIRCUIT_STATE, CONFIG, false, 0);
    state = recordOutcome(state, CONFIG, true, 1);
    expect(state).toEqual({ state: 'CLOSED', consecutiveFailures: 0, openedAtMs: null });
  });

  it('denies requests while OPEN and cooldown has not elapsed', () => {
    const openState: CircuitBreakerState = { state: 'OPEN', consecutiveFailures: 3, openedAtMs: 1000 };
    const result = checkAllowRequest(openState, CONFIG, 1000 + CONFIG.cooldownMs - 1);
    expect(result.allowed).toBe(false);
    expect(result.state.state).toBe('OPEN');
  });

  it('transitions OPEN -> HALF_OPEN and allows exactly at the cooldown boundary', () => {
    const openState: CircuitBreakerState = { state: 'OPEN', consecutiveFailures: 3, openedAtMs: 1000 };
    const result = checkAllowRequest(openState, CONFIG, 1000 + CONFIG.cooldownMs);
    expect(result.allowed).toBe(true);
    expect(result.state.state).toBe('HALF_OPEN');
  });

  it('HALF_OPEN success closes the circuit', () => {
    const halfOpen: CircuitBreakerState = { state: 'HALF_OPEN', consecutiveFailures: 3, openedAtMs: 1000 };
    const result = recordOutcome(halfOpen, CONFIG, true, 5000);
    expect(result).toEqual({ state: 'CLOSED', consecutiveFailures: 0, openedAtMs: null });
  });

  it('HALF_OPEN failure re-opens the circuit with a fresh openedAtMs', () => {
    const halfOpen: CircuitBreakerState = { state: 'HALF_OPEN', consecutiveFailures: 3, openedAtMs: 1000 };
    const result = recordOutcome(halfOpen, CONFIG, false, 5000);
    expect(result.state).toBe('OPEN');
    expect(result.openedAtMs).toBe(5000);
  });
});
