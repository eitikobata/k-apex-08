import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';

export interface KuroIceExecuteParams {
  incidentId: string;
  tier: 'LATCH' | 'SPLICE' | 'SHATTER';
  actionType: 'FLAG_ONLY' | 'BLOCK_TRAFFIC' | 'ISOLATE_NODE' | 'PREEMPTIVE_NODE_LOCKDOWN';
  triggeredByAutonomous: boolean;
}

/** Simulated "establishing countermeasure link..." delay before an action lands. */
const ESTABLISH_LINK_DELAY_MS = 1500;

@Injectable()
export class KuroIceService {
  private readonly logger = new Logger(KuroIceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
  ) {}

  async execute(params: KuroIceExecuteParams): Promise<void> {
    const action = await this.prisma.kuroIceAction.create({
      data: {
        incidentId: params.incidentId,
        tier: params.tier,
        status: 'ESTABLISHING_LINK',
        actionType: params.actionType,
        triggeredByAutonomous: params.triggeredByAutonomous,
        startedAt: new Date(),
      },
    });

    // Deliberate delay so the frontend can show "establishing countermeasure
    // link..." progress text — this isn't a real network operation, the
    // wait itself is the point (see brief: "delay proposital com texto de progresso").
    await new Promise((resolve) => setTimeout(resolve, ESTABLISH_LINK_DELAY_MS));

    await this.prisma.kuroIceAction.update({
      where: { id: action.id },
      data: {
        status: 'EXECUTED',
        completedAt: new Date(),
        resultDetail: { simulatedLatencyMs: ESTABLISH_LINK_DELAY_MS },
      },
    });

    await this.blacktape.record({
      category: 'KURO_ICE',
      action: `EXECUTED_${params.actionType}`,
      actorType: params.triggeredByAutonomous ? 'K_DIRECTIVE_AUTONOMOUS' : 'SYSTEM',
      targetType: 'Incident',
      targetId: params.incidentId,
      metadata: { tier: params.tier, actionType: params.actionType },
    });

    this.logger.log(`KURO-ICE ${params.tier} executed: ${params.actionType} for incident ${params.incidentId}`);
  }
}
