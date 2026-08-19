import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { OutboxService } from '../common/outbox/outbox.service';

const TICK_MS = 5000;
const RAW_EVENTS_STREAM = 'kapex08:k-stream:raw-events';
const HEARTBEAT_MISS_CHANCE = 0.03;

// Odds (per tick) that the simulator kicks off a deliberate multi-stage
// attack sequence somewhere in the network, vs a rogue-AI incursion, vs
// nothing beyond normal per-node noise.
// NOTE: original values (0.03/0.01) were too slow for testing; 0.15/0.08
// turned out too fast in practice — multiple Rogue AI incidents were
// landing on top of each other before the first was resolved. Settled
// here as a middle ground. The debug injection endpoint (KStreamController,
// admin-only) remains the right tool for "I need an incident right now" —
// these odds are just for ambient background activity.
const MULTI_STAGE_CHANCE = 0.08;
const ROGUE_AI_CHANCE = 0.025;

/**
 * Generates synthetic telemetry for the KMC network. Each NetworkNode has
 * its own "personality" (baselineNoiseRate, severityBias, isChronicallyFlaky)
 * so the operator can learn, over time, which nodes to trust — see the
 * project brief for the design intent behind this.
 */
@Injectable()
export class SimulatorService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSeedNodes();
    } catch (err) {
      this.logger.error(
        `Failed to seed network nodes (database may not be migrated yet): ${(err as Error).message}`,
      );
      // Deliberately swallow this — a missing/unmigrated table shouldn't crash
      // the whole app. The @Interval tick will keep retrying seeding on its
      // own schedule once the schema exists.
    }
  }

  private async ensureSeedNodes(): Promise<void> {
    const count = await this.prisma.networkNode.count();
    if (count > 0) return;

    this.logger.log('No network nodes found — seeding default KMC node roster');
    const seedNodes = Array.from({ length: 24 }, (_, i) => {
      const sector = Math.floor(i / 4) + 1;
      const isChronicallyFlaky = i % 7 === 0;
      return {
        codeName: `NODE-${String(i + 1).padStart(2, '0')}`,
        sector,
        baselineNoiseRate: isChronicallyFlaky ? 0.4 : 0.08,
        severityBias: isChronicallyFlaky ? 0.05 : 0.15,
        isChronicallyFlaky,
        lastHeartbeatAt: new Date(),
      };
    });

    await this.prisma.networkNode.createMany({ data: seedNodes });
  }

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    let nodes: Awaited<ReturnType<typeof this.prisma.networkNode.findMany>>;
    try {
      nodes = await this.prisma.networkNode.findMany();
    } catch (err) {
      this.logger.error(`Tick skipped — network_nodes query failed: ${(err as Error).message}`);
      return;
    }
    if (nodes.length === 0) return;

    for (const node of nodes) {
      await this.maybeTouchHeartbeat(node.id);
      await this.maybeEmitNoiseOrAnomaly(node.id, node.baselineNoiseRate, node.severityBias);
    }

    if (Math.random() < MULTI_STAGE_CHANCE) {
      await this.injectMultiStageSequence(nodes);
    }
    if (Math.random() < ROGUE_AI_CHANCE) {
      const target = nodes[Math.floor(Math.random() * nodes.length)];
      await this.injectRogueAiSignature(target.id);
    }
  }

  /**
   * Refreshes the node's heartbeat most ticks. With HEARTBEAT_MISS_CHANCE
   * it deliberately skips the refresh, which is exactly the signal
   * KSilenceScannerService watches for (lastHeartbeatAt going stale).
   */
  private async maybeTouchHeartbeat(nodeId: string): Promise<void> {
    if (Math.random() < HEARTBEAT_MISS_CHANCE) return;
    await this.prisma.networkNode.update({ where: { id: nodeId }, data: { lastHeartbeatAt: new Date() } });
  }

  private async maybeEmitNoiseOrAnomaly(nodeId: string, noiseRate: number, severityBias: number): Promise<void> {
    if (Math.random() >= noiseRate) return;
    const kind = Math.random() < severityBias ? 'ANOMALOUS_TRAFFIC' : 'NOISE';
    await this.emitEvent(nodeId, kind, { synthetic: true });
  }

  /** Node goes silent -> anomalous traffic on a neighbor -> privileged access attempt. */
  async injectMultiStageSequence(nodes: { id: string; sector: number }[]): Promise<void> {
    const origin = nodes[Math.floor(Math.random() * nodes.length)];
    const neighbors = nodes.filter((n) => n.sector === origin.sector && n.id !== origin.id);
    const neighbor = neighbors.length > 0 ? neighbors[0] : origin;
    const correlationTag = randomUUID();

    this.logger.warn(`Injecting multi-stage attack sequence, tag=${correlationTag}`);

    await this.emitEvent(origin.id, 'NODE_SILENCE', { staged: true }, correlationTag);
    // Staggered slightly so timestamps aren't identical — mirrors a real
    // recon -> lateral-movement -> escalation cadence.
    setTimeout(() => {
      void this.emitEvent(neighbor.id, 'ANOMALOUS_TRAFFIC', { staged: true }, correlationTag);
    }, 1500);
    setTimeout(() => {
      void this.emitEvent(neighbor.id, 'PRIVILEGED_ACCESS_ATTEMPT', { staged: true }, correlationTag);
    }, 3000);
  }

  /**
   * A rogue-AI incursion signature. `signatureVector` deliberately drifts
   * across the events the second (adaptive) detector will pull for this
   * correlationTag — see K-STREAM's RogueAiDetectorService.
   */
  async injectRogueAiSignature(nodeId: string): Promise<void> {
    const correlationTag = randomUUID();
    this.logger.warn(`Injecting rogue-AI signature on node=${nodeId}, tag=${correlationTag}`);

    for (let i = 0; i < 4; i += 1) {
      const driftFactor = i / 3; // 0 -> 1, signature "evolves"
      await this.emitEvent(
        nodeId,
        'ROGUE_AI_SIGNATURE',
        { driftFactor, sample: i },
        correlationTag,
        { driftFactor, intervalJitterMs: Math.round(200 + driftFactor * 800) },
      );
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 400 + i * 250));
    }
  }

  private async emitEvent(
    nodeId: string,
    kind:
      | 'NOISE'
      | 'ANOMALOUS_TRAFFIC'
      | 'PRIVILEGED_ACCESS_ATTEMPT'
      | 'NODE_SILENCE'
      | 'AUTH_INTRUSION_ATTEMPT'
      | 'ROGUE_AI_SIGNATURE',
    payload: Record<string, unknown>,
    correlationTag?: string,
    signatureVector?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const event = await tx.rawEvent.create({
        data: {
          nodeId,
          kind,
          payload: payload as never,
          correlationTag,
          signatureVector: signatureVector as never,
        },
      });

      await this.outbox.write(tx, {
        streamKey: RAW_EVENTS_STREAM,
        eventType: 'RAW_EVENT_CREATED',
        payload: {
          rawEventId: event.id,
          nodeId,
          kind,
          correlationTag: correlationTag ?? null,
          createdAtIso: event.createdAt.toISOString(),
        },
      });
    });
  }
}
