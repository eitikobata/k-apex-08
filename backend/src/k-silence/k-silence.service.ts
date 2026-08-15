import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { OutboxService } from '../common/outbox/outbox.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { computeBackoffMs } from './backoff.util';

export const K_SILENCE_QUEUE = 'k-silence-retry';
const EXPECTED_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS_WINDOW_LABEL = '~2min of backoff retries';
const INCIDENTS_STREAM = 'kapex08:k-directive:incidents';

interface RetryJobData {
  silenceStateId: string;
  attemptNumber: number;
}

/**
 * Scans for nodes that missed their expected heartbeat and kicks off the
 * K-SILENCE retry flow. A missed heartbeat does NOT escalate straight to an
 * incident — it tries to self-resolve first via backoff retries, and only
 * escalates once every configured attempt is exhausted.
 */
@Injectable()
export class KSilenceScannerService {
  private readonly logger = new Logger(KSilenceScannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
    @InjectQueue(K_SILENCE_QUEUE) private readonly retryQueue: Queue<RetryJobData>,
  ) {}

  @Interval(5000)
  async scanForSilentNodes(): Promise<void> {
    const cutoff = new Date(Date.now() - EXPECTED_HEARTBEAT_INTERVAL_MS);
    const staleNodes = await this.prisma.networkNode.findMany({
      where: {
        OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null }],
      },
    });

    for (const node of staleNodes) {
      const alreadyTracked = await this.prisma.silenceState.findFirst({
        where: { nodeId: node.id, status: { in: ['RETRYING', 'CONFIRMED_SILENT'] } },
      });
      if (alreadyTracked) continue; // already being handled

      const silenceState = await this.prisma.silenceState.create({
        data: {
          nodeId: node.id,
          status: 'RETRYING',
          maxAttempts: MAX_ATTEMPTS,
          firstMissedAt: node.lastHeartbeatAt ?? new Date(),
        },
      });

      await this.blacktape.record({
        category: 'K_SILENCE',
        action: 'SILENCE_DETECTED',
        actorType: 'SYSTEM',
        targetType: 'NetworkNode',
        targetId: node.id,
        metadata: { silenceStateId: silenceState.id },
      });

      await this.scheduleRetry(silenceState.id, 1);
    }
  }

  private async scheduleRetry(silenceStateId: string, attemptNumber: number): Promise<void> {
    const delayMs = computeBackoffMs(attemptNumber);
    await this.retryQueue.add(
      'retry-heartbeat',
      { silenceStateId, attemptNumber },
      { delay: delayMs, jobId: `${silenceStateId}-${attemptNumber}` },
    );
  }

  /** Exposed for the processor to chain the next attempt. */
  async scheduleNext(silenceStateId: string, attemptNumber: number): Promise<void> {
    await this.scheduleRetry(silenceStateId, attemptNumber);
  }
}

@Processor(K_SILENCE_QUEUE)
@Injectable()
export class KSilenceRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(KSilenceRetryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly scanner: KSilenceScannerService,
  ) {
    super();
  }

  async process(job: Job<RetryJobData>): Promise<void> {
    const { silenceStateId, attemptNumber } = job.data;
    const idempotencyKey = `${silenceStateId}:${attemptNumber}`;

    const { alreadyProcessed } = await this.idempotency.runOnce(K_SILENCE_QUEUE, idempotencyKey, async (tx) => {
      const silenceState = await tx.silenceState.findUniqueOrThrow({
        where: { id: silenceStateId },
        include: { node: true },
      });

      if (silenceState.status !== 'RETRYING') {
        // Already resolved or escalated by a previous (possibly concurrent)
        // attempt — nothing to do.
        return;
      }

      // "Reconnection" in our simulated world succeeds if the node's
      // heartbeat has been refreshed since we first noticed the silence
      // (i.e. the simulator un-silenced it on a later tick).
      const reconnected = !!silenceState.node.lastHeartbeatAt && silenceState.node.lastHeartbeatAt > silenceState.createdAt;

      await tx.silenceRetryAttempt.create({
        data: {
          silenceStateId,
          attemptNumber,
          succeeded: reconnected,
          backoffMs: job.opts.delay ?? 0,
        },
      });

      await this.blacktape.record({
        category: 'K_SILENCE',
        action: reconnected ? 'RETRY_SUCCEEDED' : 'RETRY_FAILED',
        actorType: 'SYSTEM',
        targetType: 'SilenceState',
        targetId: silenceStateId,
        metadata: { attemptNumber },
      });

      if (reconnected) {
        await tx.silenceState.update({
          where: { id: silenceStateId },
          data: { status: 'RESOLVED', resolvedAt: new Date(), attemptCount: attemptNumber },
        });
        return;
      }

      if (attemptNumber >= silenceState.maxAttempts) {
        // Exhausted every retry — escalate for real. Silence that self-
        // resolves never touches KURO-ICE; silence that survives every
        // retry is a legitimate SPLICE candidate (something prevented
        // reconnection — worth investigating).
        const incident = await tx.incident.create({
          data: {
            tier: 'SPLICE',
            kind: 'NODE_SILENCE',
            status: 'AWAITING_OPERATOR',
            summary: `Node silent after ${attemptNumber} retry attempts over ${MAX_ATTEMPTS_WINDOW_LABEL}`,
            contributingEventIds: [],
          },
        });
        await tx.silenceState.update({
          where: { id: silenceStateId },
          data: { status: 'CONFIRMED_SILENT', attemptCount: attemptNumber, escalatedIncidentId: incident.id },
        });
        await this.outbox.write(tx, {
          streamKey: INCIDENTS_STREAM,
          eventType: 'INCIDENT_RAISED',
          payload: { incidentId: incident.id, tier: 'SPLICE', kind: 'NODE_SILENCE', silenceStateId },
        });
        return;
      }

      await tx.silenceState.update({ where: { id: silenceStateId }, data: { attemptCount: attemptNumber } });
      // Schedule outside the transaction below (queue add isn't transactional with Postgres).
    });

    if (alreadyProcessed) return;

    // If we got here without resolving/escalating, schedule the next attempt.
    const current = await this.prisma.silenceState.findUnique({ where: { id: silenceStateId } });
    if (current?.status === 'RETRYING' && attemptNumber < current.maxAttempts) {
      await this.scanner.scheduleNext(silenceStateId, attemptNumber + 1);
    }
  }
}
