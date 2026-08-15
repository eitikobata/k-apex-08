import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { OutboxService } from '../common/outbox/outbox.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import type { Redis } from 'ioredis';
import { KBlackboxService } from '../k-blackbox/k-blackbox.service';
import { transitionRogueAi, RogueAiCommand, RogueAiState } from './rogue-ai-state-machine.util';

export const STEP_WINDOW_MS = 15_000;
const DEADLINE_SWEEP_INTERVAL_MS = 2000;
const GATEWAY_EVENTS_CHANNEL = 'kapex08:gateway:events';

export interface CommandAttemptResult {
  outcome: string;
  newState: RogueAiState;
}

/**
 * Wraps the pure rogue-ai-state-machine util with persistence, K-BLACKTAPE
 * logging, and the two ways an incident can end without operator input:
 * a missed deadline (handled here on a timer) or the dead man's switch
 * being active (handled by K-DIRECTIVE calling `resolveAutonomously`).
 */
@Injectable()
export class RogueAiService {
  private readonly logger = new Logger(RogueAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
    private readonly outbox: OutboxService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly kBlackbox: KBlackboxService,
  ) {}

  async issueCommand(
    rogueAiIncidentId: string,
    command: RogueAiCommand,
    issuedByOperatorId: string,
  ): Promise<CommandAttemptResult> {
    const record = await this.prisma.rogueAiIncident.findUnique({ where: { id: rogueAiIncidentId } });
    if (!record) throw new NotFoundException('Rogue AI incident not found');

    const now = Date.now();
    const transition = transitionRogueAi({
      state: record.state,
      expectedNextCommand: record.expectedNextCommand,
      stepDeadlineMs: record.stepDeadlineAt?.getTime() ?? null,
      event: { type: 'COMMAND_ISSUED', command, nowMs: now },
      stepWindowMs: STEP_WINDOW_MS,
    });

    await this.applyTransition(record.id, transition, command, issuedByOperatorId, false);
    return { outcome: transition.outcome, newState: transition.nextState };
  }

  /** Swept periodically — catches incidents where nobody issued a command in time. */
  @Interval(DEADLINE_SWEEP_INTERVAL_MS)
  async sweepExpiredDeadlines(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.rogueAiIncident.findMany({
      where: {
        state: { in: ['DETECTED', 'CONTAINED_STEP_1', 'CONTAINED_STEP_2'] },
        stepDeadlineAt: { lt: now },
      },
    });

    for (const record of expired) {
      const transition = transitionRogueAi({
        state: record.state,
        expectedNextCommand: record.expectedNextCommand,
        stepDeadlineMs: record.stepDeadlineAt?.getTime() ?? null,
        event: { type: 'DEADLINE_EXPIRED' },
        stepWindowMs: STEP_WINDOW_MS,
      });
      // eslint-disable-next-line no-await-in-loop
      await this.applyTransition(record.id, transition, null, null, false);
    }
  }

  /**
   * Called by K-DIRECTIVE when the dead man's switch is active and a
   * rogue-AI incident needs resolving without a human. Deliberately does
   * NOT try to replay the manual command sequence — applies a blunt,
   * expensive preemptive response instead (full node lockdown), consistent
   * with "no human, the system still wins, but it wins uglier".
   */
  async resolveAutonomously(rogueAiIncidentId: string): Promise<void> {
    const record = await this.prisma.rogueAiIncident.findUniqueOrThrow({ where: { id: rogueAiIncidentId } });
    if (['NEUTRALIZED', 'ESCALATED', 'SPREAD'].includes(record.state)) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.rogueAiIncident.update({
        where: { id: rogueAiIncidentId },
        data: {
          state: 'NEUTRALIZED',
          expectedNextCommand: null,
          stepDeadlineAt: null,
          resolvedAutonomously: true,
        },
      });
      await tx.incident.update({
        where: { id: record.incidentId },
        data: { status: 'RESOLVED', resolutionOrigin: 'AUTO_TIMEOUT', resolvedAt: new Date() },
      });
    });

    await this.kBlackbox.archiveResolvedIncident(record.incidentId);

    await this.blacktape.record({
      category: 'ROGUE_AI',
      action: 'RESOLVED_AUTONOMOUSLY',
      actorType: 'K_DIRECTIVE_AUTONOMOUS',
      targetType: 'RogueAiIncident',
      targetId: rogueAiIncidentId,
      metadata: { nodeId: record.nodeId, method: 'PREEMPTIVE_NODE_LOCKDOWN' },
    });

    await this.publishGatewayEvent('ROGUE_AI_RESOLVED_AUTONOMOUSLY', { rogueAiIncidentId, nodeId: record.nodeId });
  }

  /**
   * Called by K-DIRECTIVE right before it notifies the operator. The
   * deadline recorded at detection time (by K-STREAM) can go stale while
   * the incident sits in K-DIRECTIVE's processing queue — refreshing it
   * here means the operator's countdown starts when they're actually
   * told, not when the system silently noticed.
   */
  async refreshDeadlineOnNotify(rogueAiIncidentId: string): Promise<void> {
    const record = await this.prisma.rogueAiIncident.findUnique({ where: { id: rogueAiIncidentId } });
    if (!record || record.state !== 'DETECTED') return;

    await this.prisma.rogueAiIncident.update({
      where: { id: rogueAiIncidentId },
      data: { stepDeadlineAt: new Date(Date.now() + STEP_WINDOW_MS) },
    });
  }

  private async applyTransition(
    rogueAiIncidentId: string,
    transition: ReturnType<typeof transitionRogueAi>,
    command: RogueAiCommand | null,
    issuedByOperatorId: string | null,
    resolvedAutonomously: boolean,
  ): Promise<void> {
    const record = await this.prisma.rogueAiIncident.findUniqueOrThrow({ where: { id: rogueAiIncidentId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.rogueAiIncident.update({
        where: { id: rogueAiIncidentId },
        data: {
          state: transition.nextState,
          expectedNextCommand: transition.nextExpectedCommand,
          stepDeadlineAt: transition.nextDeadlineMs ? new Date(transition.nextDeadlineMs) : null,
          resolvedAutonomously,
        },
      });

      if (command) {
        await tx.rogueAiCommandAttempt.create({
          data: {
            rogueAiIncidentId,
            command,
            wasExpected: transition.outcome === 'ADVANCED' || transition.outcome === 'NEUTRALIZED',
            wasWithinDeadline: transition.outcome !== 'DEADLINE_EXPIRED',
            issuedByOperatorId: issuedByOperatorId ?? undefined,
          },
        });
      }

      const terminal = ['NEUTRALIZED', 'ESCALATED', 'SPREAD'].includes(transition.nextState);
      if (terminal) {
        await tx.incident.update({
          where: { id: record.incidentId },
          data: {
            status: transition.nextState === 'NEUTRALIZED' ? 'RESOLVED' : 'ESCALATED',
            resolvedAt: transition.nextState === 'NEUTRALIZED' ? new Date() : undefined,
            resolutionOrigin: transition.nextState === 'NEUTRALIZED' ? 'MANUAL_OPERATOR' : undefined,
          },
        });
      }
    });

    if (transition.nextState === 'NEUTRALIZED') {
      await this.kBlackbox.archiveResolvedIncident(record.incidentId);
    }

    await this.blacktape.record({
      category: 'ROGUE_AI',
      action: `TRANSITION_${transition.outcome}`,
      actorType: issuedByOperatorId ? 'OPERATOR' : 'SYSTEM',
      actorId: issuedByOperatorId ?? undefined,
      targetType: 'RogueAiIncident',
      targetId: rogueAiIncidentId,
      metadata: { command, nextState: transition.nextState },
    });

    await this.publishGatewayEvent('ROGUE_AI_TRANSITION', {
      rogueAiIncidentId,
      outcome: transition.outcome,
      nextState: transition.nextState,
    });
  }

  private async publishGatewayEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(GATEWAY_EVENTS_CHANNEL, JSON.stringify({ eventType, payload }));
  }
}
