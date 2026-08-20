import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { KStreamService } from '../k-stream/k-stream.service';
import { computeBackoffMs } from './backoff.util';

const EXPECTED_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS_WINDOW_LABEL = '~2min of backoff retries';
const SWEEP_INTERVAL_MS = 2000;
const RECOVERY_DELAY_MS = 3000;
const GATEWAY_EVENTS_CHANNEL = 'kapex08:gateway:events';

/**
 * Scans for nodes that missed their expected heartbeat and kicks off the
 * K-SILENCE retry flow. A missed heartbeat does NOT escalate straight to an
 * incident — it tries to self-resolve first via backoff retries, and only
 * escalates once every configured attempt is exhausted.
 *
 * NOTE (rewrite): this used to run retries through a BullMQ queue
 * (KSilenceRetryProcessor, @Processor decorator, delayed jobs). Every
 * SilenceState in production got permanently stuck in RETRYING with zero
 * logged attempts — the worker never processed a single job, for days,
 * across all 24 nodes. Root cause was never confirmed (no live access to
 * the queue/Redis to inspect), so rather than keep guessing at BullMQ
 * config blind, this switches to the same @Interval sweep pattern already
 * proven to work elsewhere in this codebase (RogueAiService's deadline
 * sweep). SilenceState.nextRetryAt, already in the schema, now doubles as
 * "when to next check this" for both retry progression AND the new
 * recovery flow (RECOVERING status) — one sweep method drives both.
 */
@Injectable()
export class KSilenceScannerService {
  private readonly logger = new Logger(KSilenceScannerService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
    private readonly kStream: KStreamService,
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
      if (alreadyTracked) continue; // already being handled

      // eslint-disable-next-line no-await-in-loop
      const silenceState = await this.prisma.silenceState.create({
        data: {
          nodeId: node.id,
          status: 'RETRYING',
          maxAttempts: MAX_ATTEMPTS,
          firstMissedAt: node.lastHeartbeatAt ?? new Date(),
          nextRetryAt: new Date(Date.now() + computeBackoffMs(1)),
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
    }
  }

  /**
   * Single sweep, two jobs: advance RETRYING states whose backoff window
   * elapsed, and complete RECOVERING states whose 3s recovery delay
   * elapsed. Kept in one interval (not two) since they're the same shape
   * of work — "is it time to act on this SilenceState yet".
   */
  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.silenceState.findMany({
      where: { status: { in: ['RETRYING', 'RECOVERING'] }, nextRetryAt: { lte: now } },
      include: { node: true },
    });

    for (const state of due) {
      if (state.status === 'RECOVERING') {
        // eslint-disable-next-line no-await-in-loop
        await this.completeRecovery(state);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await this.advanceRetry(state);
      }
    }
  }

  private async advanceRetry(state: {
    id: string;
    nodeId: string;
    attemptCount: number;
    maxAttempts: number;
    createdAt: Date;
    node: { id: string; codeName: string; lastHeartbeatAt: Date | null };
  }): Promise<void> {
    const attemptNumber = state.attemptCount + 1;
    // "Reconnection" succeeds if the node's heartbeat has been refreshed
    // since we first noticed the silence (the simulator un-silenced it on
    // a later tick).
    const reconnected = !!state.node.lastHeartbeatAt && state.node.lastHeartbeatAt > state.createdAt;

    await this.prisma.silenceRetryAttempt.create({
      data: { silenceStateId: state.id, attemptNumber, succeeded: reconnected, backoffMs: computeBackoffMs(attemptNumber) },
    });
    await this.blacktape.record({
      category: 'K_SILENCE',
      action: reconnected ? 'RETRY_SUCCEEDED' : 'RETRY_FAILED',
      actorType: 'SYSTEM',
      targetType: 'SilenceState',
      targetId: state.id,
      metadata: { attemptNumber, codeName: state.node.codeName },
    });

    if (reconnected) {
      await this.prisma.silenceState.update({
        where: { id: state.id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), attemptCount: attemptNumber },
      });
      return;
    }

    if (attemptNumber >= state.maxAttempts) {
      // Exhausted every retry — escalate for real. Silence that
      // self-resolves never touches KURO-ICE; silence that survives every
      // retry is a legitimate SPLICE candidate.
      const incidentId = await this.kStream.raiseNodeSilenceIncident(attemptNumber);
      await this.prisma.silenceState.update({
        where: { id: state.id },
        data: { status: 'CONFIRMED_SILENT', attemptCount: attemptNumber, escalatedIncidentId: incidentId, nextRetryAt: null },
      });
      return;
    }

    await this.prisma.silenceState.update({
      where: { id: state.id },
      data: { attemptCount: attemptNumber, nextRetryAt: new Date(Date.now() + computeBackoffMs(attemptNumber + 1)) },
    });
  }

  private async completeRecovery(state: { id: string; nodeId: string; node: { codeName: string } }): Promise<void> {
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
    await this.notifyGateway('NODE_RECOVERED', { codeName: state.node.codeName });
    this.logger.warn(`Node recovered: ${state.node.codeName}`);
  }

  /**
   * Called by K-DIRECTIVE right after an operator confirms a NODE_SILENCE
   * incident (see k-directive.service.ts's confirmByOperator). This is
   * the piece that makes resolving the incident an actual technical
   * action instead of pure paperwork — the node comes back online
   * RECOVERY_DELAY_MS later, for real, via the same sweep that drives
   * retries.
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
    await this.notifyGateway('NODE_RECOVERY_SCHEDULED', { codeName: state.node.codeName, recoverAt: recoverAt.toISOString() });
    this.logger.warn(`Recovery scheduled for ${state.node.codeName}, back online at ${recoverAt.toISOString()}`);
  }

  private async notifyGateway(eventType: string, payload: Record<string, unknown>): Promise<void> {
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
