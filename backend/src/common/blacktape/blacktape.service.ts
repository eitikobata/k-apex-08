import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BlacktapeCategory =
  | 'AUTH'
  | 'INCIDENT'
  | 'KURO_ICE'
  | 'K_SILENCE'
  | 'K_DIRECTIVE'
  | 'ROGUE_AI';

export type BlacktapeActorType = 'OPERATOR' | 'SYSTEM' | 'K_DIRECTIVE_AUTONOMOUS';

export interface BlacktapeEntryInput {
  category: BlacktapeCategory;
  action: string;
  actorType: BlacktapeActorType;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * K-BLACKTAPE — the corp's immutable audit trail.
 *
 * Deliberately exposes no update()/delete(). Nothing in this codebase should
 * ever mutate a written entry — that invariant is enforced here by omission,
 * not by a DB trigger (a real deploy would add a REVOKE UPDATE/DELETE grant
 * or a trigger too; documented as a follow-up, see README "Hardening TODO").
 */
@Injectable()
export class BlacktapeService {
  private readonly logger = new Logger(BlacktapeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: BlacktapeEntryInput): Promise<void> {
    await this.prisma.blacktapeEntry.create({
      data: {
        category: entry.category,
        action: entry.action,
        actorType: entry.actorType,
        actorId: entry.actorId,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata as never,
      },
    });
    this.logger.debug(`[${entry.category}] ${entry.action} by ${entry.actorType}:${entry.actorId ?? 'n/a'}`);
  }

  async findByTarget(targetType: string, targetId: string) {
    return this.prisma.blacktapeEntry.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByCategory(category: BlacktapeCategory, take = 100) {
    return this.prisma.blacktapeEntry.findMany({
      where: { category },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Backs GET /k-blacktape/entries — AuditLogPanel.tsx. */
  async listEntries(category?: BlacktapeCategory, take = 200): Promise<
    { id: string; category: string; action: string; actorType: string; actorId: string | null; targetType: string | null; targetId: string | null; createdAt: Date }[]
  > {
    return this.prisma.blacktapeEntry.findMany({
      where: category ? { category } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        category: true,
        action: true,
        actorType: true,
        actorId: true,
        targetType: true,
        targetId: true,
        createdAt: true,
      },
    });
  }
}
