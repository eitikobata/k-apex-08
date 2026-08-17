import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { AiEnrichmentService } from './ai-enrichment.service';

@Injectable()
export class KBlackboxService {
  private readonly logger = new Logger(KBlackboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
    private readonly aiEnrichment: AiEnrichmentService,
  ) {}

  /** Called once an incident resolves — archives it without an AI summary yet. */
  async archiveResolvedIncident(incidentId: string): Promise<void> {
    const existing = await this.prisma.caseFile.findUnique({ where: { incidentId } });
    if (existing) return;
    await this.prisma.caseFile.create({ data: { incidentId } });
  }

  /**
   * Operator mode: explicit "Generate K-DIRECTIVE Analysis" button click.
   * Autonomous mode: a policy check (kept intentionally simple here — always
   * attempt, the circuit breaker is the real gate) decides whether to call at all.
   *
   * Also generates the semantic-search embedding from the same summary text,
   * once it exists. Embedding failure never fails the whole request — a
   * case with a summary but no embedding just isn't searchable yet, which
   * is a strictly better outcome than losing the summary too.
   */
  async requestAiSummary(incidentId: string): Promise<{ summary: string | null; skipped?: string }> {
    const caseFile = await this.prisma.caseFile.findUnique({
      where: { incidentId },
      include: { incident: { include: { kuroIceActions: true, rogueAiIncident: true } } },
    });
    if (!caseFile) throw new NotFoundException('Case file not found — incident may not be archived yet');

    const context = {
      tier: caseFile.incident.tier,
      kind: caseFile.incident.kind,
      status: caseFile.incident.status,
      resolutionOrigin: caseFile.incident.resolutionOrigin,
      kuroIceActions: caseFile.incident.kuroIceActions.map((a) => ({ actionType: a.actionType, status: a.status })),
      wasRogueAi: !!caseFile.incident.rogueAiIncident,
    };

    const result = await this.aiEnrichment.summarizeIncident(context);

    await this.prisma.caseFile.update({
      where: { incidentId },
      data: { aiSummary: result.summary, aiSummaryFailed: !result.summary },
    });

    if (result.summary) {
      await this.generateAndStoreEmbedding(incidentId, result.summary);
    }

    return { summary: result.summary, skipped: result.skippedReason };
  }

  private async generateAndStoreEmbedding(incidentId: string, summaryText: string): Promise<void> {
    try {
      const embedding = await this.aiEnrichment.generateEmbedding(summaryText);
      if (!embedding) return; // circuit open, no key, or API failure — already logged upstream

      const vectorLiteral = `[${embedding.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE case_files SET embedding = $1::vector WHERE "incidentId" = $2`,
        vectorLiteral,
        incidentId,
      );
    } catch (err) {
      // A raw SQL failure here (e.g. dimension mismatch) shouldn't take
      // down a request that already successfully saved the summary.
      this.logger.error(`Failed to store embedding for incident ${incidentId}: ${(err as Error).message}`);
    }
  }

  /**
   * Semantic search over past cases via pgvector cosine distance — raw SQL
   * because Prisma's query builder doesn't support the `<=>` operator.
   */
  async findSimilarCases(embedding: number[], limit = 5) {
    const vectorLiteral = `[${embedding.join(',')}]`;
    return this.prisma.$queryRawUnsafe(
      `SELECT id, "incidentId", "aiSummary", embedding <=> $1::vector AS distance
       FROM case_files
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT $2`,
      vectorLiteral,
      limit,
    );
  }

  /** Reconstructs an incident's timeline event-by-event from K-BLACKTAPE. */
  async replayIncident(incidentId: string) {
    const entries = await this.blacktape.findByTarget('Incident', incidentId);
    const kuroIceEntries = await this.blacktape.findByTarget('KuroIceAction', incidentId);
    return [...entries, ...kuroIceEntries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
