import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';

/**
 * Reusable across both HTTP (PermissionsGuard) and WebSocket (CommandService)
 * paths — the guard checks the request object, this service is the actual
 * decision logic both funnel through, so the rule ("ADMIN bypasses, others
 * need an explicit grant") lives in exactly one place.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
  ) {}

  async hasPermission(operatorId: string, role: string, scope: string): Promise<boolean> {
    if (role === 'ADMIN') return true;

    const grant = await this.prisma.operatorPermission.findUnique({
      where: { operatorId_scope: { operatorId, scope } },
    });
    return !!grant;
  }

  async grant(operatorId: string, scope: string, grantedByOperatorId: string): Promise<void> {
    await this.prisma.operatorPermission.upsert({
      where: { operatorId_scope: { operatorId, scope } },
      create: { operatorId, scope },
      update: {},
    });
    await this.blacktape.record({
      category: 'AUTH',
      action: 'PERMISSION_GRANTED',
      actorType: 'OPERATOR',
      actorId: grantedByOperatorId,
      targetType: 'Operator',
      targetId: operatorId,
      metadata: { scope },
    });
  }

  async revoke(operatorId: string, scope: string, revokedByOperatorId: string): Promise<void> {
    await this.prisma.operatorPermission.deleteMany({ where: { operatorId, scope } });
    await this.blacktape.record({
      category: 'AUTH',
      action: 'PERMISSION_REVOKED',
      actorType: 'OPERATOR',
      actorId: revokedByOperatorId,
      targetType: 'Operator',
      targetId: operatorId,
      metadata: { scope },
    });
  }

  async list(operatorId: string): Promise<string[]> {
    const grants = await this.prisma.operatorPermission.findMany({ where: { operatorId } });
    return grants.map((g) => g.scope);
  }
}
