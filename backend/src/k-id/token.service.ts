import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function fingerprintOf(ip: string, userAgent: string): string {
  return createHash('sha256').update(`${ip}::${userAgent}`).digest('hex');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly blacktape: BlacktapeService,
  ) {}

  private refreshTtlMs(): number {
    const days = this.config.get<number>('JWT_REFRESH_TTL_DAYS', 14);
    return days * 24 * 60 * 60 * 1000;
  }

  /** Issues a brand new access+refresh pair, starting a new rotation family. */
  async issuePair(operatorId: string, role: string, fingerprint: string): Promise<IssuedTokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: operatorId, role });
    const rawRefresh = randomBytes(48).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs());

    await this.prisma.refreshToken.create({
      data: {
        operatorId,
        tokenHash: hashToken(rawRefresh),
        fingerprint,
        familyId: randomUUID(),
        expiresAt: refreshExpiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefresh, refreshExpiresAt };
  }

  /**
   * Rotates a refresh token. Throws UnauthorizedException for any invalid
   * presentation. A *reused* (already-rotated-away) token triggers a
   * full-family revocation — that's the theft-detection behavior.
   */
  async rotate(rawRefreshToken: string, fingerprint: string): Promise<IssuedTokenPair> {
    const tokenHash = hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new UnauthorizedException('Refresh token not recognized');
    }

    if (existing.revokedAt) {
      // Token was already rotated away (or manually revoked) and is being
      // presented again — classic replay signature. Nuke the whole family.
      await this.revokeFamily(existing.familyId, existing.operatorId, 'REUSE_DETECTED');
      await this.blacktape.record({
        category: 'AUTH',
        action: 'REFRESH_REUSE_DETECTED',
        actorType: 'SYSTEM',
        targetType: 'Operator',
        targetId: existing.operatorId,
        metadata: { familyId: existing.familyId },
      });
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (existing.fingerprint !== fingerprint) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'FINGERPRINT_MISMATCH' },
      });
      await this.blacktape.record({
        category: 'AUTH',
        action: 'SESSION_REVOKED',
        actorType: 'SYSTEM',
        targetType: 'Operator',
        targetId: existing.operatorId,
        metadata: { reason: 'FINGERPRINT_MISMATCH' },
      });
      throw new UnauthorizedException('Session fingerprint mismatch — please sign in again');
    }

    const operator = await this.prisma.operator.findUniqueOrThrow({ where: { id: existing.operatorId } });

    const rawNewRefresh = randomBytes(48).toString('hex');
    const newTokenHash = hashToken(rawNewRefresh);
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs());

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED', rotatedAt: new Date(), replacedByHash: newTokenHash },
      }),
      this.prisma.refreshToken.create({
        data: {
          operatorId: existing.operatorId,
          tokenHash: newTokenHash,
          fingerprint,
          familyId: existing.familyId,
          expiresAt: refreshExpiresAt,
        },
      }),
    ]);

    const accessToken = await this.jwt.signAsync({ sub: operator.id, role: operator.role });

    return { accessToken, refreshToken: rawNewRefresh, refreshExpiresAt };
  }

  async revokeFamily(familyId: string, operatorId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, operatorId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForOperator(operatorId: string, reason = 'MANUAL_LOGOUT'): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { operatorId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
