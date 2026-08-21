import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { KStreamService } from '../k-stream/k-stream.service';
import { computeBackoffMs } from './backoff.util';

export const K_SILENCE_QUEUE = 'k-silence-retry';
const EXPECTED_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RECOVERY_DELAY_MS = 3000;
const GATEWAY_EVENTS_CHANNEL = 'kapex08:gateway:events';

// NOTE (design fix, not just BullMQ reinstatement): with the interval-based
// version, a silence episode almost always got cured by ambient heartbeat
// noise before the FIRST retry check (10s) even ran — SimulatorService
// touches every node's heartbeat every tick regardless of whether it's
// currently RETRYING, so a node had ~98% odds of "recovering" from noise
// alone within that first 10s window. Real data confirmed it: every single
// SilenceState resolved at attemptCount=1, the 30s/90s backoff steps were
// never actually reachable. Fixed at the source (SimulatorService.tick
// now skips heartbeat-touch for nodes with an active SilenceState) —
// recovery is now ONLY decided here, at each real retry checkpoint, via
// this roll. That's what makes the backoff drama (and a real chance of
// escalating to SPLICE) something you can actually observe.
const RECOVERY_CHANCE_PER_ATTEMPT = 0.4;

interface RetryJobData {
  silenceStateId: string;
  attemptNumber: number;
}

interface RecoveryJobData {
  silenceStateId: string;
}

/**
 * Scans for nodes that missed their expected heartbeat and kicks off the
 * K-SILENCE retry flow via BullMQ (delayed jobs, 10s/30s/90s backoff —
 * matches the brief's original design). A missed heartbeat does NOT
 * escalate straight to an incident — it tries to self-resolve first via
 * backoff retries, and only escalates once every configured attempt is
 * exhausted.
 *
 * NOTE (history): this briefly ran on an @Interval polling sweep instead
 * of BullMQ, after every SilenceState got stuck in RETRYING for days with
 * zero jobs ever processed — but that switch happened before the actual
 * root cause was ever diagnosed (no live queue/worker logs were available
 * at the time). Reverted back to BullMQ, this time with permanent
 * @OnWorkerEvent instrumentation on the processor below, so if it breaks
 * again there's an actual log trail instead of another guess.
 */
@Injectable()
export class KSilenceScannerService {
  private readonly logger = new Logger(KSilenceScannerService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
    @InjectQueue(K_SILENCE_QUEUE) private readonly queue: Queue<RetryJobData | RecoveryJobData>,
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
      // eslint-disable-next-line no-await-in-loop
      const alreadyTracked = await this.prisma.silenceState.findFirst({
        where: { nodeId: node.id, status: { in: ['RETRYING', 'CONFIRMED_SILENT', 'RECOVERING'] } },
      });
      if (alreadyTracked) continue;

      // eslint-disable-next-line no-await-in-loop
      const silenceState = await this.prisma.silenceState.create({
        data: {
          nodeId: node.id,
          status: 'RETRYING',
          maxAttempts: MAX_ATTEMPTS,
          firstMissedAt: node.lastHeartbeatAt ?? new Date(),
        },
      });

      // eslint-disable-next-line no-await-in-loop
      await this.blacktape.record({
        category: 'K_SILENCE',
        action: 'SILENCE_DETECTED',
        actorType: 'SYSTEM',
        targetType: 'NetworkNode',
        targetId: node.id,
        metadata: { silenceStateId: silenceState.id, codeName: node.codeName },
      });

      // eslint-disable-next-line no-await-in-loop
      await this.scheduleRetry(silenceState.id, 1);
    }
  }

  private async scheduleRetry(silenceStateId: string, attemptNumber: number): Promise<void> {
    const delayMs = computeBackoffMs(attemptNumber);
    await this.queue.add(
      'retry-heartbeat',
      { silenceStateId, attemptNumber },
      { delay: delayMs, jobId: `${silenceStateId}-retry-${attemptNumber}` },
    );
  }

  /** Exposed for the processor to chain the next attempt. */
  async scheduleNext(silenceStateId: string, attemptNumber: number): Promise<void> {
    await this.scheduleRetry(silenceStateId, attemptNumber);
  }

  /**
   * Called by K-DIRECTIVE right after an operator confirms a NODE_SILENCE
   * incident (see k-directive.service.ts's confirmByOperator). Schedules
   * the node's real recovery RECOVERY_DELAY_MS later, via the same queue
   * (not a raw setTimeout — survives a server restart in that window).
   */
  async scheduleRecoveryForIncident(incidentId: string): Promise<void> {
    const state = await this.prisma.silenceState.findUnique({
      where: { escalatedIncidentId: incidentId },
      include: { node: true },
    });
    if (!state || state.status !== 'CONFIRMED_SILENT') return;

    const recoverAt = new Date(Date.now() + RECOVERY_DELAY_MS);
    await this.prisma.silenceState.update({
      where: { id: state.id },
      data: { status: 'RECOVERING', nextRetryAt: recoverAt },
    });
    await this.queue.add(
      'complete-recovery',
      { silenceStateId: state.id },
      { delay: RECOVERY_DELAY_MS, jobId: `${state.id}-recovery` },
    );
    await this.notifyGateway('NODE_RECOVERY_SCHEDULED', { codeName: state.node.codeName, recoverAt: recoverAt.toISOString() });
    this.logger.warn(`Recovery scheduled for ${state.node.codeName}, back online at ${recoverAt.toISOString()}`);
  }

  async notifyGateway(eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(GATEWAY_EVENTS_CHANNEL, JSON.stringify({ eventType, payload }));
  }

  /**
   * Backs GET /k-silence/nodes — NodeGrid.tsx's 24-node status grid. A
   * node can have MULTIPLE SilenceState rows over its lifetime (one per
   * silence episode — no unique constraint on nodeId), so this takes only
   * the most recent one per node via the relation's own orderBy+take, not
   * a separate query per node. No SilenceState at all (never gone silent)
   * defaults to ALIVE, matching a fresh node's real status. attemptCount
   * and (while RECOVERING) the scheduled recovery time ride along so the
   * grid can show "retry 2/3" or a countdown instead of just a color.
   */
  async listNodes(): Promise<
    {
      codeName: string;
      sector: number;
      status: string;
      lastHeartbeatAt: Date | null;
      attemptCount: number | null;
      maxAttempts: number | null;
      recoverAt: Date | null;
    }[]
  > {
    const nodes = await this.prisma.networkNode.findMany({
      orderBy: { codeName: 'asc' },
      include: { silenceStates: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return nodes.map(
      (node: {
        codeName: string;
        sector: number;
        lastHeartbeatAt: Date | null;
        silenceStates: { status: string; attemptCount: number; maxAttempts: number; nextRetryAt: Date | null }[];
      }) => {
        const latest = node.silenceStates[0];
        return {
          codeName: node.codeName,
          sector: node.sector,
          status: latest?.status ?? 'ALIVE',
          lastHeartbeatAt: node.lastHeartbeatAt,
          attemptCount: latest?.status === 'RETRYING' ? latest.attemptCount : null,
          maxAttempts: latest?.status === 'RETRYING' ? latest.maxAttempts : null,
          recoverAt: latest?.status === 'RECOVERING' ? latest.nextRetryAt : null,
        };
      },
    );
  }
}

@Processor(K_SILENCE_QUEUE)
@Injectable()
export class KSilenceRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(KSilenceRetryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
    private readonly kStream: KStreamService,
    private readonly scanner: KSilenceScannerService,
  ) {
    super();
  }

  // Permanent observability, not a one-off debugging aid — these fire for
  // every job either way, cheap, and mean a future "everything's stuck
  // again" report comes with an actual log trail on day one instead of
  // needing another round-trip to add instrumentation first.
  @OnWorkerEvent('active')
  onActive(job: Job<RetryJobData | RecoveryJobData>) {
    this.logger.warn(`[BullMQ] job ACTIVE: ${job.name}#${job.id}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<RetryJobData | RecoveryJobData>) {
    this.logger.warn(`[BullMQ] job COMPLETED: ${job.name}#${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<RetryJobData | RecoveryJobData> | undefined, err: Error) {
    this.logger.error(`[BullMQ] job FAILED: ${job?.name ?? 'unknown'}#${job?.id ?? '?'} — ${err.message}`, err.stack);
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.error(`[BullMQ] worker ERROR (connection/infra level): ${err.message}`, err.stack);
  }

  async process(job: Job<RetryJobData | RecoveryJobData>): Promise<void> {
    if (job.name === 'complete-recovery') {
      await this.completeRecovery((job.data as RecoveryJobData).silenceStateId);
      return;
    }
    await this.processRetry(job.data as RetryJobData);
  }

  private async processRetry({ silenceStateId, attemptNumber }: RetryJobData): Promise<void> {
    const state = await this.prisma.silenceState.findUnique({
      where: { id: silenceStateId },
      include: { node: true },
    });
    // Already resolved/escalated by something else (or the row's gone) —
    // nothing to do. Not an error, just a stale job.
    if (!state || state.status !== 'RETRYING') return;

    const recovered = Math.random() < RECOVERY_CHANCE_PER_ATTEMPT;

    await this.prisma.silenceRetryAttempt.create({
      data: { silenceStateId, attemptNumber, succeeded: recovered, backoffMs: computeBackoffMs(attemptNumber) },
    });
    await this.blacktape.record({
      category: 'K_SILENCE',
      action: recovered ? 'RETRY_SUCCEEDED' : 'RETRY_FAILED',
      actorType: 'SYSTEM',
      targetType: 'SilenceState',
      targetId: silenceStateId,
      metadata: { attemptNumber, codeName: state.node.codeName },
    });

    if (recovered) {
      await this.prisma.$transaction([
        this.prisma.networkNode.update({ where: { id: state.nodeId }, data: { lastHeartbeatAt: new Date() } }),
        this.prisma.silenceState.update({
          where: { id: silenceStateId },
          data: { status: 'RESOLVED', resolvedAt: new Date(), attemptCount: attemptNumber },
        }),
      ]);
      return;
    }

    if (attemptNumber >= state.maxAttempts) {
      // Exhausted every retry — escalate for real. Silence that
      // self-resolves never touches KURO-ICE; silence that survives every
      // retry is a legitimate SPLICE candidate.
      const incidentId = await this.kStream.raiseNodeSilenceIncident(attemptNumber);
      await this.prisma.silenceState.update({
        where: { id: silenceStateId },
        data: { status: 'CONFIRMED_SILENT', attemptCount: attemptNumber, escalatedIncidentId: incidentId },
      });
      return;
    }

    await this.prisma.silenceState.update({
      where: { id: silenceStateId },
      data: { attemptCount: attemptNumber },
    });
    await this.scanner.scheduleNext(silenceStateId, attemptNumber + 1);
  }

  private async completeRecovery(silenceStateId: string): Promise<void> {
    const state = await this.prisma.silenceState.findUnique({
      where: { id: silenceStateId },
      include: { node: true },
    });
    if (!state || state.status !== 'RECOVERING') return;

    await this.prisma.$transaction([
      this.prisma.networkNode.update({ where: { id: state.nodeId }, data: { lastHeartbeatAt: new Date() } }),
      this.prisma.silenceState.update({
        where: { id: state.id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), nextRetryAt: null },
      }),
    ]);
    await this.blacktape.record({
      category: 'K_SILENCE',
      action: 'NODE_RECOVERED',
      actorType: 'SYSTEM',
      targetType: 'NetworkNode',
      targetId: state.nodeId,
      metadata: { codeName: state.node.codeName },
    });
    await this.scanner.notifyGateway('NODE_RECOVERED', { codeName: state.node.codeName });
    this.logger.warn(`Node recovered: ${state.node.codeName}`);
  }
}
