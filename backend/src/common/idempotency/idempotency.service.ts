import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Guards BullMQ job handlers against duplicate side effects on reprocessing
 * (BullMQ delivers at-least-once, never exactly-once — a job can be retried
 * after a crash even if the side effect already committed).
 *
 * Pattern: inside one DB transaction, try to insert a `(queueName, idempotencyKey)`
 * marker row first. If that insert violates the unique constraint, this exact
 * job was already processed — skip the side effect entirely. If it succeeds,
 * run the side effect in the same transaction, so "marker written" and
 * "effect applied" always commit or roll back together.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runOnce<T>(
    queueName: string,
    idempotencyKey: string,
    effect: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ alreadyProcessed: boolean; result?: T }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.processedJob.create({ data: { queueName, idempotencyKey } });
        const result = await effect(tx);
        return { alreadyProcessed: false, result };
      });
    } catch (err) {
      if (err instanceof PrismaNS.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        this.logger.debug(`Skipped duplicate job [${queueName}] key=${idempotencyKey}`);
        return { alreadyProcessed: true };
      }
      throw err;
    }
  }
}
