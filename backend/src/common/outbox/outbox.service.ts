import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Outbox pattern, part 1: write the "I need to publish this" intent in the
 * SAME transaction as the domain state change. A separate worker
 * (OutboxPublisherService) guarantees delivery to Redis afterwards.
 *
 * This avoids the classic split-brain: "saved to Postgres but never
 * published to the stream" (crash between the two writes) or the reverse
 * (published but the DB write rolled back).
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Must be called with a transaction client (`tx`) obtained from
   * `prisma.$transaction(async (tx) => { ... })` — passing the plain
   * PrismaService here defeats the whole point of the pattern.
   */
  async write(
    tx: Prisma.TransactionClient,
    params: { streamKey: string; eventType: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        streamKey: params.streamKey,
        eventType: params.eventType,
        payload: params.payload as never,
      },
    });
  }

  /** Convenience for callers that don't need a wider transaction. */
  async writeStandalone(params: {
    streamKey: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.write(this.prisma as unknown as Prisma.TransactionClient, params);
  }
}
