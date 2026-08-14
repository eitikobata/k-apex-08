import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 10;

/**
 * Outbox pattern, part 2. Polls `outbox_events` for PENDING rows and
 * XADDs them to their target Redis stream. Marks PUBLISHED on success,
 * increments `attempts` and records `lastError` on failure (a row that
 * keeps failing past MAX_ATTEMPTS is marked FAILED and stops being
 * retried automatically — surfaced via K-BLACKTAPE for a human to look at).
 *
 * Polling instead of LISTEN/NOTIFY is a deliberate simplicity trade-off for
 * this hobby scale (single instance, no need for sub-second delivery) — see
 * README "things I'd change at real scale".
 */
@Injectable()
export class OutboxPublisherService implements OnModuleInit {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.logger.log('Outbox publisher armed — polling every 1s');
  }

  @Interval(POLL_INTERVAL_MS)
  async handleInterval(): Promise<void> {
    if (this.running) return; // avoid overlapping runs if a batch is slow
    this.running = true;
    try {
      await this.publishPendingBatch();
    } catch (err) {
      this.logger.error(`Outbox publish batch failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async publishPendingBatch(): Promise<void> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const event of pending) {
      try {
        await this.redis.xadd(
          event.streamKey,
          '*',
          'eventType',
          event.eventType,
          'payload',
          JSON.stringify(event.payload),
          'outboxId',
          event.id,
        );
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
        });
      } catch (err) {
        const attempts = event.attempts + 1;
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts,
            lastError: (err as Error).message,
            status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          },
        });
      }
    }
  }
}
