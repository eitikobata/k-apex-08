import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { OutboxService } from '../common/outbox/outbox.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { evaluateSlidingWindow, CorrelationConfig } from './sliding-window-correlator.util';
import { detectRogueAiAdaptiveSignature } from './rogue-ai-detector.util';

const RAW_EVENTS_STREAM = 'kapex08:k-stream:raw-events';
const INCIDENTS_STREAM = 'kapex08:k-directive:incidents';
const CONSUMER_GROUP = 'k-stream-correlator';
const CONSUMER_NAME = 'k-stream-worker-1';
const POLL_INTERVAL_MS = 1000;
const READ_COUNT = 50;

// NOTE: threshold bumped 4->5 alongside the flaky-node noise rate coming
// down (see SimulatorService's seedNodes) — the two changes work together,
// don't tune just one in isolation or you're back to constant LATCH spam.
const GENERIC_CORRELATION: CorrelationConfig = { windowMs: 60_000, threshold: 5 };
const ROGUE_AI_MIN_SAMPLES = 3;

interface NodeWindowState {
  timestamps: number[];
}

/**
 * Ingests raw events (published by the Outbox publisher, originally written
 * by SimulatorService) via a Redis Streams consumer group, and correlates
 * them into incidents. In-memory correlation buffers are a deliberate
 * simplicity trade-off for single-instance hobby scale — a restart loses
 * partial correlation windows, which just means a slightly delayed
 * detection on the next matching events, not a correctness bug.
 */
@Injectable()
export class KStreamService implements OnModuleInit {
  private readonly logger = new Logger(KStreamService.name);
  private running = false;

  // nodeId -> recent generic-severity event timestamps
  private readonly nodeWindows = new Map<string, NodeWindowState>();
  // correlationTag -> ordered driftFactor samples (rogue AI candidate)
  private readonly rogueAiSamples = new Map<string, number[]>();
  // correlationTag -> node id the rogue AI signature is on (first sample wins)
  private readonly rogueAiNode = new Map<string, string>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly blacktape: BlacktapeService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', RAW_EVENTS_STREAM, CONSUMER_GROUP, '$', 'MKSTREAM');
      this.logger.log(`Consumer group ${CONSUMER_GROUP} created on ${RAW_EVENTS_STREAM}`);
    } catch (err) {
      // BUSYGROUP means it already exists — fine, everything else is a real problem.
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
      this.logger.error(`K-Stream poll failed: ${(err as Error).message}`);
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
      READ_COUNT,
      'STREAMS',
      RAW_EVENTS_STREAM,
      '>',
    );

    if (!response) return;

    // ioredis shape: [[streamKey, [[id, [field, value, field, value, ...]], ...]]]
    const [, messages] = response[0] as [string, [string, string[]][]];

    for (const [messageId, fields] of messages) {
      try {
        await this.processMessage(fields);
      } catch (err) {
        this.logger.error(`Failed to process message ${messageId}: ${(err as Error).message}`);
      } finally {
        await this.redis.xack(RAW_EVENTS_STREAM, CONSUMER_GROUP, messageId);
      }
    }
  }

  private async processMessage(fields: string[]): Promise<void> {
    const record: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      record[fields[i]] = fields[i + 1];
    }
    const payload = JSON.parse(record.payload ?? '{}') as {
      rawEventId: string;
      nodeId: string;
      kind: string;
      correlationTag: string | null;
    };

    const now = Date.now();

    if (payload.kind === 'ROGUE_AI_SIGNATURE' && payload.correlationTag) {
      await this.handleRogueAiSample(payload.correlationTag, payload.nodeId, payload.rawEventId);
      return;
    }

    if (payload.kind === 'NODE_SILENCE' || payload.kind === 'AUTH_INTRUSION_ATTEMPT') {
      // K-SILENCE and K-ID own their own escalation paths — K-STREAM's
      // generic correlator only tracks noise/anomaly/privileged-access here.
      return;
    }

    const state = this.nodeWindows.get(payload.nodeId) ?? { timestamps: [] };
    state.timestamps.push(now);
    this.nodeWindows.set(payload.nodeId, state);

    const result = evaluateSlidingWindow(state.timestamps, now, GENERIC_CORRELATION);
    this.nodeWindows.set(payload.nodeId, { timestamps: result.countedTimestampsMs });

    if (result.triggered) {
      await this.raiseIncident({
        tier: 'LATCH',
        kind: payload.kind as never,
        correlationTag: payload.correlationTag ?? undefined,
        contributingEventIds: [payload.rawEventId],
        summary: `Correlated ${result.countedTimestampsMs.length} events on node within ${GENERIC_CORRELATION.windowMs}ms`,
      });
      this.nodeWindows.delete(payload.nodeId); // reset after raising, avoid re-triggering on same burst
    }
  }

  private async handleRogueAiSample(correlationTag: string, nodeId: string, rawEventId: string): Promise<void> {
    const event = await this.prisma.rawEvent.findUnique({ where: { id: rawEventId } });
    const driftFactor = (event?.signatureVector as { driftFactor?: number } | null)?.driftFactor ?? 0;

    const samples = this.rogueAiSamples.get(correlationTag) ?? [];
    samples.push(driftFactor);
    this.rogueAiSamples.set(correlationTag, samples);
    if (!this.rogueAiNode.has(correlationTag)) {
      this.rogueAiNode.set(correlationTag, nodeId);
    }

    if (samples.length < ROGUE_AI_MIN_SAMPLES) return;

    if (detectRogueAiAdaptiveSignature(samples)) {
      await this.raiseIncident({
        tier: 'SHATTER',
        kind: 'ROGUE_AI_SIGNATURE',
        correlationTag,
        contributingEventIds: [rawEventId],
        summary: `Rogue-AI adaptive signature confirmed on node after ${samples.length} drifting samples`,
        isRogueAi: true,
        rogueAiNodeId: this.rogueAiNode.get(correlationTag)!,
      });
      this.rogueAiSamples.delete(correlationTag);
      this.rogueAiNode.delete(correlationTag);
    }
  }

  private async raiseIncident(params: {
    tier: 'LATCH' | 'SPLICE' | 'SHATTER';
    kind: string;
    correlationTag?: string;
    contributingEventIds: string[];
    summary: string;
    isRogueAi?: boolean;
    rogueAiNodeId?: string;
  }): Promise<string> {
    const incidentId = await this.prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          tier: params.tier,
          kind: params.kind as never,
          correlationTag: params.correlationTag,
          contributingEventIds: params.contributingEventIds,
          summary: params.summary,
          status: 'PENDING_CORRELATION',
        },
      });

        if (params.isRogueAi && params.rogueAiNodeId) {
                await tx.rogueAiIncident.create({
                  data: {
                    incidentId: incident.id,
                    nodeId: params.rogueAiNodeId,
                    state: 'DETECTED',
                    expectedNextCommand: 'ISOLATE',
                    // Deliberately no deadline yet — the countdown only starts when
                    // K-DIRECTIVE actually notifies the operator (refreshDeadlineOnNotify),
                    // not at detection time. Otherwise a busy K-DIRECTIVE queue can
                    // let the deadline expire before the operator ever sees it.
                  },
                });
              }

      await this.outbox.write(tx, {
        streamKey: INCIDENTS_STREAM,
        eventType: 'INCIDENT_RAISED',
        payload: { incidentId: incident.id, tier: params.tier, kind: params.kind },
      });

      return incident.id;
    });

    // NOTE: category 'INCIDENT' existed in BlacktapeCategory but nothing in
    // the codebase ever wrote an entry with it — the K-BLACKTAPE tab for
    // "Incidents" was always empty, not because of a bug in reading it,
    // but because nothing produced that data. This is the fix: every
    // incident's creation (organic, silence-escalated, or debug-injected)
    // now leaves a real trail here.
    await this.blacktape.record({
      category: 'INCIDENT',
      action: 'INCIDENT_RAISED',
      actorType: 'SYSTEM',
      targetType: 'Incident',
      targetId: incidentId,
      metadata: { tier: params.tier, kind: params.kind },
    });

    this.logger.warn(`Incident raised: tier=${params.tier} kind=${params.kind}`);
    return incidentId;
  }

  /**
   * Admin-only testing utility (see KStreamController) — forces an
   * incident straight into the same pipeline a real detection uses,
   * instead of waiting on SimulatorService's random ticks (per-tick
   * chance, which makes manual testing painfully slow at low settings).
   * Reuses raiseIncident, so everything downstream — K-DIRECTIVE routing,
   * operator notification, autonomous-mode auto-resolution, Rogue AI
   * containment — behaves identically to an organic incident. There's no
   * real RawEvent backing this (contributingEventIds is empty) — it's
   * clearly labeled as injected in the summary so it's never confused
   * with a genuine detection in K-BLACKBOX or Blacktape.
   */
  /**
   * Public entry point for K-SILENCE — lets KSilenceScannerService raise a
   * SPLICE incident through the exact same pipeline everything else uses
   * (K-DIRECTIVE routing, INCIDENT category blacktape entry, outbox), so
   * "a node went silent" behaves identically to any other incident once
   * it exists, no special-casing needed downstream.
   */
  async raiseNodeSilenceIncident(attemptCount: number): Promise<string> {
    return this.raiseIncident({
      tier: 'SPLICE',
      kind: 'NODE_SILENCE',
      contributingEventIds: [],
      summary: `Node silent after ${attemptCount} retry attempts`,
    });
  }

  async debugInjectIncident(type: 'LATCH' | 'SPLICE' | 'SHATTER' | 'ROGUE_AI'): Promise<{ incidentId: string }> {
    const isRogueAi = type === 'ROGUE_AI';
    const tier: 'LATCH' | 'SPLICE' | 'SHATTER' = isRogueAi ? 'SHATTER' : type;
    const kind = isRogueAi ? 'ROGUE_AI_SIGNATURE' : tier === 'SPLICE' ? 'NODE_SILENCE' : 'PRIVILEGED_ACCESS_ATTEMPT';

    let rogueAiNodeId: string | undefined;
    if (isRogueAi) {
      // Same "one Rogue AI at a time" rule the simulator follows now
      // (see SimulatorService.tick) — the debug button is a shortcut for
      // testing, not an exemption from the rule it's testing.
      const activeCount = await this.prisma.rogueAiIncident.count({
        where: { state: { in: ['DETECTED', 'CONTAINED_STEP_1', 'CONTAINED_STEP_2'] } },
      });
      if (activeCount > 0) {
        throw new BadRequestException('A Rogue AI incident is already active — resolve it before injecting another.');
      }

      const nodes = await this.prisma.networkNode.findMany();
      if (nodes.length === 0) {
        throw new Error('No network nodes seeded yet — the simulator seeds them on first tick, try again shortly');
      }
      rogueAiNodeId = nodes[Math.floor(Math.random() * nodes.length)].id;
    }

    const incidentId = await this.raiseIncident({
      tier,
      kind,
      contributingEventIds: [],
      summary: `[DEBUG] Manually injected by admin (${type})`,
      isRogueAi,
      rogueAiNodeId,
    });

    this.logger.warn(`[DEBUG] Incident manually injected: type=${type} id=${incidentId}`);
    return { incidentId };
  }

  /**
   * Backs GET /k-stream/incidents — history backfill for IncidentsPanel,
   * which otherwise only knows about incidents seen via live socket
   * events since the tab was opened. Capped at 100, most recent first;
   * this is a history list for orientation, not a paginated archive.
   */
  async listIncidents(): Promise<
    { id: string; tier: string; status: string; kind: string; summary: string | null; createdAt: Date; resolvedAt: Date | null }[]
  > {
    return this.prisma.incident.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, tier: true, status: true, kind: true, summary: true, createdAt: true, resolvedAt: true },
    });
  }
}
