import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { consume, lockoutDurationMs, TokenBucketConfig } from './token-bucket.util';

const BUCKET_CONFIG: TokenBucketConfig = {
  capacity: 10,
  // 10 tokens refill over 10 minutes => 1 token per 60s
  refillRatePerMs: 1 / 60_000,
};

export interface RateLimitCheckResult {
  allowed: boolean;
  lockedUntil: Date | null;
}

/**
 * Persists the token-bucket state per known operator (login attempts) in
 * Postgres, since these are audit-relevant and low-frequency enough that a
 * DB round-trip per login attempt is not a bottleneck at this project's scale.
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
  ) {}

  async checkAndConsume(operatorId: string, now: Date = new Date()): Promise<RateLimitCheckResult> {
    const bucket = await this.prisma.rateLimitBucket.upsert({
      where: { operatorId },
      create: { operatorId, tokens: BUCKET_CONFIG.capacity, lastRefill: now },
      update: {},
    });

    if (bucket.lockedUntil && bucket.lockedUntil > now) {
      return { allowed: false, lockedUntil: bucket.lockedUntil };
    }

    const result = consume(
      { tokens: bucket.tokens, lastRefillMs: bucket.lastRefill.getTime() },
      BUCKET_CONFIG,
      now.getTime(),
    );

    await this.prisma.rateLimitBucket.update({
      where: { operatorId },
      data: {
        tokens: result.state.tokens,
        lastRefill: new Date(result.state.lastRefillMs),
      },
    });

    return { allowed: result.allowed, lockedUntil: null };
  }

  /** Call after a failed login attempt (bad password / bad MFA). */
  async registerFailure(operatorId: string, now: Date = new Date()): Promise<void> {
    const bucket = await this.prisma.rateLimitBucket.upsert({
      where: { operatorId },
      create: { operatorId, failCount: 1, tokens: BUCKET_CONFIG.capacity, lastRefill: now },
      update: { failCount: { increment: 1 } },
    });

    const failCount = bucket.failCount;
    const durationMs = lockoutDurationMs(failCount);
    const lockedUntil = durationMs > 0 ? new Date(now.getTime() + durationMs) : null;

    await this.prisma.rateLimitBucket.update({
      where: { operatorId },
      data: { lockedUntil },
    });

    if (lockedUntil) {
      await this.blacktape.record({
        category: 'AUTH',
        action: 'LOCKOUT_TRIGGERED',
        actorType: 'SYSTEM',
        targetType: 'Operator',
        targetId: operatorId,
        metadata: { failCount, lockedUntilIso: lockedUntil.toISOString() },
      });
    }
  }

  /** Call after a successful login — resets the failure streak. */
  async registerSuccess(operatorId: string): Promise<void> {
    await this.prisma.rateLimitBucket.upsert({
      where: { operatorId },
      create: { operatorId, tokens: BUCKET_CONFIG.capacity - 1 },
      update: { failCount: 0, lockedUntil: null },
    });
  }
}
