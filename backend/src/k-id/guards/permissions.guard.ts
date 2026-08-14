import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredScopes || requiredScopes.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const operatorId: string | undefined = request.operator?.id;
    const operatorRole: string | undefined = request.operator?.role;
    if (!operatorId) return false;

    // ADMIN bypasses granular scope checks by design (role hierarchy).
    if (operatorRole === 'ADMIN') return true;

    const grants = await this.prisma.operatorPermission.findMany({
      where: { operatorId, scope: { in: requiredScopes } },
    });
    const grantedScopes = new Set(grants.map((g) => g.scope));
    return requiredScopes.every((scope) => grantedScopes.has(scope));
  }
}
