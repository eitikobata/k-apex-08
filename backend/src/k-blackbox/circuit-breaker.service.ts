import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CircuitBreakerConfig,
  CircuitBreakerState,
  INITIAL_CIRCUIT_STATE,
  checkAllowRequest,
  recordOutcome,
} from './circuit-breaker.util';

/**
 * In-memory circuit state — resets to CLOSED on process restart, which is
 * the safe default direction (never boots up already refusing AI calls).
 * A single breaker instance guards the one external AI provider call this
 * project makes; if a second provider is ever added, give it its own state.
 */
@Injectable()
export class CircuitBreakerService {
  private state: CircuitBreakerState = INITIAL_CIRCUIT_STATE;

  constructor(private readonly config: ConfigService) {}

  private breakerConfig(): CircuitBreakerConfig {
    return {
      failureThreshold: this.config.get<number>('AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),
      cooldownMs: this.config.get<number>('AI_CIRCUIT_BREAKER_COOLDOWN_MS', 30_000),
    };
  }

  isRequestAllowed(): boolean {
    const result = checkAllowRequest(this.state, this.breakerConfig(), Date.now());
    this.state = result.state;
    return result.allowed;
  }

  reportSuccess(): void {
    this.state = recordOutcome(this.state, this.breakerConfig(), true, Date.now());
  }

  reportFailure(): void {
    this.state = recordOutcome(this.state, this.breakerConfig(), false, Date.now());
  }

  getState(): CircuitBreakerState {
    return this.state;
  }
}
