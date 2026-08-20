import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { AutonomousModeService } from './autonomous-mode.service';
import { RogueAiService } from '../rogue-ai/rogue-ai.service';
import { KuroIceService } from '../kuro-ice/kuro-ice.service';
import { decideIncidentHandling } from './decision.util';
import { KBlackboxService } from '../k-blackbox/k-blackbox.service';
import { KSilenceScannerService } from '../k-silence/k-silence.service';

const INCIDENTS_STREAM = 'kapex08:k-directive:incidents';
const CONSUMER_GROUP = 'k-directive-processor';
const CONSUMER_NAME = 'k-directive-worker-1';
const POLL_INTERVAL_MS = 1000;
const GATEWAY_EVENTS_CHANNEL = 'kapex08:gateway:events';
const DEADLINE_SWEEP_INTERVAL_MS = 2000;

// Tier-scaled operator deadline — matches TIER_TIMER_MS in
// IncidentsPanel.tsx on the frontend (keep both in sync if this changes).
// Lower severity gets more time, SHATTER gets the least — same escalating-
// difficulty pattern as everywhere else in this project.
const OPERATOR_DEADLINE_MS: Record<'LATCH' | 'SPLICE' | 'SHATTER', number> = {
  LATCH: 90_000,
  SPLICE: 60_000,
  SHATTER: 30_000,
};

@Injectable()
export class KDirectiveService implements OnModuleInit {
  private readonly logger = new Logger(KDirectiveService.name);
  private running = false;

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        private readonly prisma: PrismaService,
        private readonly blacktape: BlacktapeService,
        private readonly idempotency: IdempotencyService,
        private readonly autonomousMode: AutonomousModeService,
        private readonly rogueAi: RogueAiService,
        private readonly kuroIce: KuroIceService,
        private readonly kBlackbox: KBlackboxService,
        private readonly kSilence: KSilenceScannerService,
      ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', INCIDENTS_STREAM, CONSUMER_GROUP, '$', 'MKSTREAM');
    } catch (err) {
      if (!(err as Error).message?.includes('BUSYGROUP')) {
        this.logger.error(`Failed to create consumer group: ${(err as Error).message}`);
      }
    }
  }

  @Interval(POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.readAndProcessBatch();
    } catch (err) {
      this.logger.error(`K-Directive poll failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async readAndProcessBatch(): Promise<void> {
    const response = await this.redis.xreadgroup(
      'GROUP',
      CONSUMER_GROUP,
      CONSUMER_NAME,
      'COUNT',
      20,
      'STREAMS',
      INCIDENTS_STREAM,
      '>',
    );
    if (!response) return;

    const [, messages] = response[0] as [string, [string, string[]][]];

    for (const [messageId, fields] of messages) {
      try {
        await this.processMessage(messageId, fields);
      } catch (err) {
        this.logger.error(`Failed to process incident message ${messageId}: ${(err as Error).message}`);
      } finally {
        await this.redis.xack(INCIDENTS_STREAM, CONSUMER_GROUP, messageId);
      }
    }
  }

  private async processMessage(messageId: string, fields: string[]): Promise<void> {
    const record: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      record[fields[i]] = fields[i + 1];
    }
    const payload = JSON.parse(record.payload ?? '{}') as { incidentId: string };

    const { alreadyProcessed } = await this.idempotency.runOnce('k-directive-incidents', messageId, async () => {
      await this.handleIncident(payload.incidentId);
    });

    if (alreadyProcessed) {
      this.logger.debug(`Incident message ${messageId} already processed, skipping`);
    }
  }

  private async handleIncident(incidentId: string): Promise<void> {
    const incident = await this.prisma.incident.findUniqueOrThrow({
      where: { id: incidentId },
      include: { rogueAiIncident: true },
    });

    const systemState = await this.autonomousMode.getState();

    // Rogue AI incidents follow their own state machine (see RogueAiService)
    // — K-DIRECTIVE's only job for them is: if autonomous mode is active,
    // resolve immediately without waiting for a command sequence.
      if (incident.rogueAiIncident) {
            await this.prisma.incident.update({ where: { id: incidentId }, data: { status: 'ROGUE_AI_ACTIVE' } });
            if (systemState.autonomousModeActive) {
              await this.rogueAi.resolveAutonomously(incident.rogueAiIncident.id);
            } else {
              await this.rogueAi.refreshDeadlineOnNotify(incident.rogueAiIncident.id);
              await this.notifyGateway('INCIDENT_AWAITING_OPERATOR', {
                incidentId,
                tier: incident.tier,
                rogueAi: true,
                rogueAiIncidentId: incident.rogueAiIncident.id,
              });
            }
            return;
          }

    const decision = decideIncidentHandling(incident.tier, systemState.autonomousModeActive);

    if (decision.requiresOperator) {
      await this.prisma.incident.update({
        where: { id: incidentId },
        data: { status: 'AWAITING_OPERATOR', operatorDeadlineAt: new Date(Date.now() + OPERATOR_DEADLINE_MS[incident.tier as 'LATCH' | 'SPLICE' | 'SHATTER']) },
      });

      // NODE_SILENCE incidents get their originating node's codeName riding
      // along — the console can't otherwise tell "this SPLICE is about
      // NODE-14 specifically" apart from any other SPLICE. Looked up via
      // the SilenceState's reverse relation rather than widening the
      // incident payload everything else reads (kind + tier is enough for
      // every other incident type).
      let nodeCode: string | undefined;
      if (incident.kind === 'NODE_SILENCE') {
        const silenceState = await this.prisma.silenceState.findUnique({
          where: { escalatedIncidentId: incidentId },
          include: { node: true },
        });
        nodeCode = silenceState?.node.codeName;
      }

      await this.notifyGateway('INCIDENT_AWAITING_OPERATOR', { incidentId, tier: incident.tier, nodeCode });
      return;
    }

    const origin = decision.autonomous
      ? systemState.activatedOrigin ?? 'AUTO_TIMEOUT'
      : 'AUTO_LOW_SEVERITY';

    await this.prisma.incident.update({
      where: { id: incidentId },
      data: { status: 'AUTO_RESOLVING', resolutionOrigin: origin },
    });

    await this.blacktape.record({
      category: 'K_DIRECTIVE',
      action: 'INCIDENT_AUTO_RESOLVED',
      actorType: decision.autonomous ? 'K_DIRECTIVE_AUTONOMOUS' : 'SYSTEM',
      targetType: 'Incident',
      targetId: incidentId,
      metadata: { tier: incident.tier, actionType: decision.actionType },
    });

    await this.kuroIce.execute({
      incidentId,
      tier: incident.tier,
      actionType: decision.actionType,
      triggeredByAutonomous: decision.autonomous,
    });

    await this.prisma.incident.update({ where: { id: incidentId }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    if (incident.kind === 'NODE_SILENCE') {
      await this.kSilence.scheduleRecoveryForIncident(incidentId);
    }
  }

  /** Manual operator confirmation for an AWAITING_OPERATOR incident (SPLICE/SHATTER). */
  async confirmByOperator(incidentId: string, operatorId: string): Promise<void> {
    const incident = await this.prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
    if (incident.status !== 'AWAITING_OPERATOR') {
      throw new Error(`Incident ${incidentId} is not awaiting operator confirmation (status=${incident.status})`);
    }

    // NOTE (bugfix): this fell through to ISOLATE_NODE for LATCH too — the
    // ternary only ever checked for SPLICE. Harmless while LATCH always
    // self-resolved (this code path was unreachable for LATCH), but now
    // that LATCH genuinely reaches operator confirmation, it needs its own
    // branch — matches decideIncidentHandling's actionType exactly.
    const actionType =
      incident.tier === 'LATCH' ? 'FLAG_ONLY' : incident.tier === 'SPLICE' ? 'BLOCK_TRAFFIC' : 'ISOLATE_NODE';

    await this.prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'AUTO_RESOLVING',
        resolutionOrigin: 'MANUAL_OPERATOR',
        resolvedByOperatorId: operatorId,
        operatorDeadlineAt: null,
      },
    });

    await this.blacktape.record({
      category: 'K_DIRECTIVE',
      action: 'INCIDENT_CONFIRMED_BY_OPERATOR',
      actorType: 'OPERATOR',
      actorId: operatorId,
      targetType: 'Incident',
      targetId: incidentId,
      metadata: { tier: incident.tier, actionType },
    });

    await this.kuroIce.execute({
      incidentId,
      tier: incident.tier,
      actionType,
      triggeredByAutonomous: false,
    });

    await this.prisma.incident.update({ where: { id: incidentId }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
        await this.kBlackbox.archiveResolvedIncident(incidentId);
        if (incident.kind === 'NODE_SILENCE') {
          await this.kSilence.scheduleRecoveryForIncident(incidentId);
        }
      }

  /**
   * Swept periodically — catches LATCH/SPLICE/SHATTER incidents where the
   * operator never confirmed in time. Same pattern as RogueAiService's
   * sweepExpiredDeadlines, just for the plain KURO-ICE confirmation flow
   * instead of the Rogue AI state machine. No auto-remediation on
   * expiry — this only marks the incident ESCALATED and notifies the
   * gateway; it deliberately does NOT attempt KURO-ICE's action for the
   * operator (that's a bigger behavioral decision — autonomous mode
   * already covers "act without a human", ESCALATED here just means
   * "a human was supposed to look at this and didn't").
   */
  @Interval(DEADLINE_SWEEP_INTERVAL_MS)
  async sweepExpiredOperatorDeadlines(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.incident.findMany({
      where: { status: 'AWAITING_OPERATOR', operatorDeadlineAt: { lt: now } },
    });

    for (const incident of expired) {
      // eslint-disable-next-line no-await-in-loop
      await this.prisma.incident.update({
        where: { id: incident.id },
        data: { status: 'ESCALATED', operatorDeadlineAt: null },
      });
      // eslint-disable-next-line no-await-in-loop
      await this.blacktape.record({
        category: 'K_DIRECTIVE',
        action: 'INCIDENT_DEADLINE_EXPIRED',
        actorType: 'SYSTEM',
        targetType: 'Incident',
        targetId: incident.id,
        metadata: { tier: incident.tier },
      });
      // eslint-disable-next-line no-await-in-loop
      await this.notifyGateway('INCIDENT_ESCALATED', { incidentId: incident.id, tier: incident.tier });
    }
  }

  private async notifyGateway(eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(GATEWAY_EVENTS_CHANNEL, JSON.stringify({ eventType, payload }));
  }
}
