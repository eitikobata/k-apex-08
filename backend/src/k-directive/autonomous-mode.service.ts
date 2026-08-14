import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';

const SINGLETON_ID = 'singleton';
const GATEWAY_EVENTS_CHANNEL = 'kapex08:gateway:events';
const HEARTBEAT_CHECK_INTERVAL_MS = 5000;

export type AutonomousOrigin = 'AUTO_TIMEOUT' | 'MANUAL_TOGGLE_AUTONOMOUS';

/**
 * K-DIRECTIVE 08's autonomous mode / dead man's switch.
 *
 * Two independent triggers converge on the same `setAutonomous()` call:
 *  1. No operator heartbeat within OPERATOR_HEARTBEAT_TIMEOUT_MS -> automatic.
 *  2. An operator explicitly hits the "GO AUTONOMOUS" button -> manual.
 * Only the recorded `activatedOrigin` differs — every downstream consumer
 * (K-DIRECTIVE's decision routing, the frontend's full-screen lockout
 * overlay) treats both the same way.
 */
@Injectable()
export class AutonomousModeService {
  private readonly logger = new Logger(AutonomousModeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly blacktape: BlacktapeService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private heartbeatTimeoutMs(): number {
    return this.config.get<number>('OPERATOR_HEARTBEAT_TIMEOUT_MS', 120_000);
  }

  async recordOperatorHeartbeat(operatorId: string): Promise<void> {
    await this.prisma.operatorHeartbeat.create({ data: { operatorId } });

    // A heartbeat arriving while autonomous mode is active due to timeout
    // (not a manual toggle) means the operator is back — hand control back.
    const state = await this.getState();
    if (state.autonomousModeActive && state.activatedOrigin === 'AUTO_TIMEOUT') {
      await this.setAutonomous(false, 'AUTO_TIMEOUT', null);
    }
  }

  @Interval(HEARTBEAT_CHECK_INTERVAL_MS)
  async checkForTimeout(): Promise<void> {
    const state = await this.getState();
    if (state.autonomousModeActive) return; // already autonomous, nothing to check

    const lastHeartbeat = await this.prisma.operatorHeartbeat.findFirst({ orderBy: { createdAt: 'desc' } });
    const lastAt = lastHeartbeat?.createdAt ?? new Date(0);
    const elapsed = Date.now() - lastAt.getTime();

    if (elapsed >= this.heartbeatTimeoutMs()) {
      await this.setAutonomous(true, 'AUTO_TIMEOUT', null);
    }
  }

  /** The manual "GO AUTONOMOUS" / "STAND DOWN" button, independent of any timeout. */
  async manualToggle(active: boolean, operatorId: string): Promise<void> {
    await this.setAutonomous(active, 'MANUAL_TOGGLE_AUTONOMOUS', operatorId);
  }

  async getState() {
    return this.prisma.systemState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
  }

  private async setAutonomous(active: boolean, origin: AutonomousOrigin, operatorId: string | null): Promise<void> {
    await this.prisma.systemState.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        autonomousModeActive: active,
        activatedAt: active ? new Date() : null,
        activatedOrigin: active ? origin : null,
        activatedByOperatorId: operatorId ?? undefined,
      },
      update: {
        autonomousModeActive: active,
        activatedAt: active ? new Date() : null,
        activatedOrigin: active ? origin : null,
        activatedByOperatorId: active ? (operatorId ?? undefined) : null,
      },
    });

    await this.blacktape.record({
      category: 'K_DIRECTIVE',
      action: active ? 'AUTONOMOUS_MODE_ACTIVATED' : 'AUTONOMOUS_MODE_DEACTIVATED',
      actorType: operatorId ? 'OPERATOR' : 'SYSTEM',
      actorId: operatorId ?? undefined,
      metadata: { origin },
    });

    this.logger.warn(`Autonomous mode ${active ? 'ACTIVATED' : 'DEACTIVATED'} (origin=${origin})`);

    await this.redis.publish(
      GATEWAY_EVENTS_CHANNEL,
      JSON.stringify({ eventType: 'AUTONOMOUS_MODE_CHANGED', payload: { active, origin } }),
    );
  }
}
