import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlacktapeService } from '../common/blacktape/blacktape.service';
import { RateLimitService } from './rate-limit.service';
import { TotpService } from './totp.service';
import { TokenService, fingerprintOf, IssuedTokenPair } from './token.service';
import { RegisterOperatorDto } from './dto/register-operator.dto';

export interface RequestContext {
  ip: string;
  userAgent: string;
}

export type LoginStep1Result =
  | { status: 'MFA_REQUIRED'; mfaPendingToken: string }
  | { status: 'MFA_SETUP_REQUIRED'; totpSetupToken: string; totpKeyUri: string }
  | ({ status: 'MFA_NOT_REQUIRED' } & IssuedTokenPair);

const ARGON2ID_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB, OWASP-recommended minimum for argon2id
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class KIdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly blacktape: BlacktapeService,
    private readonly rateLimit: RateLimitService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
  ) {}

  async registerOperator(dto: RegisterOperatorDto) {
    const passwordHash = await argon2.hash(dto.password, ARGON2ID_OPTS);
    const operator = await this.prisma.operator.create({
      data: {
        callsign: dto.callsign,
        email: dto.email,
        passwordHash,
        role: dto.role,
      },
    });
    const totpSecret = this.totp.generateSecret();
    await this.prisma.operator.update({ where: { id: operator.id }, data: { totpSecret } });
    return { operatorId: operator.id, totpKeyUri: this.totp.keyUri(dto.email, totpSecret) };
  }

  /** Step 1: credentials + rate limit. Returns an MFA challenge, never a full session — unless exempt. */
  async loginStep1(callsign: string, password: string, ctx: RequestContext): Promise<LoginStep1Result> {
    const operator = await this.prisma.operator.findUnique({ where: { callsign } });

    // Lockout check happens BEFORE password verification, and applies to
    // every attempt — not just ones where the password turns out correct.
    if (operator) {
      const gate = await this.rateLimit.checkAndConsume(operator.id);
      if (!gate.allowed) {
        throw new ForbiddenException(
          `Too many attempts. Locked until ${gate.lockedUntil?.toISOString() ?? 'further notice'}`,
        );
      }
    }

    // Deliberately do the same amount of work (argon2 verify against a dummy
    // hash) even when the callsign doesn't exist, so login timing doesn't
    // leak whether an account exists.
    const hashToCheck = operator?.passwordHash ?? (await this.dummyHash());
    const passwordOk = await argon2.verify(hashToCheck, password).catch(() => false);

    if (!operator || !passwordOk) {
      if (operator) {
        await this.rateLimit.registerFailure(operator.id);
        await this.blacktape.record({
          category: 'AUTH',
          action: 'LOGIN_FAILURE',
          actorType: 'SYSTEM',
          targetType: 'Operator',
          targetId: operator.id,
          metadata: { ip: ctx.ip },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.rateLimit.registerSuccess(operator.id);
    await this.blacktape.record({
      category: 'AUTH',
      action: 'LOGIN_SUCCESS',
      actorType: 'OPERATOR',
      actorId: operator.id,
      metadata: { ip: ctx.ip, userAgent: ctx.userAgent },
    });

    // Defense in depth: the exemption flag alone is not enough — it only
    // takes effect for OBSERVER accounts, which cannot issue any command
    // (see CommandService). A stray/misconfigured flag on a higher-privilege
    // account is silently ignored, not honored.
    if (operator.mfaExempt && operator.role === 'OBSERVER') {
      const fingerprint = fingerprintOf(ctx.ip, ctx.userAgent);
      const pair = await this.tokens.issuePair(operator.id, operator.role, fingerprint);
      await this.blacktape.record({
        category: 'AUTH',
        action: 'MFA_EXEMPT_LOGIN',
        actorType: 'OPERATOR',
        actorId: operator.id,
      });
      return { status: 'MFA_NOT_REQUIRED', ...pair };
    }

    if (!operator.totpEnabled) {
      // First login: no session yet, but we still need a token so the
      // operator can prove who they are when confirming TOTP enrollment.
      const totpSetupToken = await this.jwt.signAsync(
        { sub: operator.id, type: 'totp_setup_pending' },
        { expiresIn: '10m' },
      );
      const totpKeyUri = operator.totpSecret ? this.totp.keyUri(operator.email, operator.totpSecret) : '';
      return { status: 'MFA_SETUP_REQUIRED', totpSetupToken, totpKeyUri };
    }

    const mfaPendingToken = await this.jwt.signAsync(
      { sub: operator.id, type: 'mfa_pending' },
      { expiresIn: '5m' },
    );
    return { status: 'MFA_REQUIRED', mfaPendingToken };
  }

  /** Step 2: consumes the MFA-pending token + TOTP code, issues a full session. */
  async completeLoginWithTotp(mfaPendingToken: string, totpCode: string, ctx: RequestContext): Promise<IssuedTokenPair> {
    let payload: { sub: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(mfaPendingToken);
    } catch {
      throw new UnauthorizedException('MFA challenge expired or invalid');
    }
    if (payload.type !== 'mfa_pending') {
      throw new UnauthorizedException('Invalid MFA challenge token');
    }

    const operator = await this.prisma.operator.findUniqueOrThrow({ where: { id: payload.sub } });
    if (!operator.totpSecret) {
      throw new UnauthorizedException('TOTP not enrolled for this operator');
    }

    const valid = this.totp.verify(totpCode, operator.totpSecret);
    if (!valid) {
      await this.rateLimit.registerFailure(operator.id);
      await this.blacktape.record({
        category: 'AUTH',
        action: 'MFA_FAILURE',
        actorType: 'OPERATOR',
        actorId: operator.id,
        metadata: { ip: ctx.ip },
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.blacktape.record({
      category: 'AUTH',
      action: 'MFA_SUCCESS',
      actorType: 'OPERATOR',
      actorId: operator.id,
      metadata: { ip: ctx.ip },
    });

    const fingerprint = fingerprintOf(ctx.ip, ctx.userAgent);
    return this.tokens.issuePair(operator.id, operator.role, fingerprint);
  }

  /** Confirms TOTP enrollment and, on success, logs the operator straight in. */
  async completeTotpSetup(totpSetupToken: string, totpCode: string, ctx: RequestContext): Promise<IssuedTokenPair> {
    let payload: { sub: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(totpSetupToken);
    } catch {
      throw new UnauthorizedException('TOTP setup challenge expired or invalid');
    }
    if (payload.type !== 'totp_setup_pending') {
      throw new UnauthorizedException('Invalid TOTP setup challenge token');
    }

    await this.enableTotp(payload.sub, totpCode);

    const operator = await this.prisma.operator.findUniqueOrThrow({ where: { id: payload.sub } });
    const fingerprint = fingerprintOf(ctx.ip, ctx.userAgent);
    return this.tokens.issuePair(operator.id, operator.role, fingerprint);
  }

  async enableTotp(operatorId: string, totpCode: string): Promise<void> {
    const operator = await this.prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
    if (!operator.totpSecret) {
      throw new UnauthorizedException('No TOTP secret provisioned — call registerOperator first');
    }
    const valid = this.totp.verify(totpCode, operator.totpSecret);
    if (!valid) {
      throw new UnauthorizedException('Invalid TOTP code — enrollment not confirmed');
    }
    await this.prisma.operator.update({ where: { id: operatorId }, data: { totpEnabled: true } });
  }

  async changePassword(operatorId: string, currentPassword: string, newPassword: string): Promise<void> {
    const operator = await this.prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
    const valid = await argon2.verify(operator.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await argon2.hash(newPassword, ARGON2ID_OPTS);
    await this.prisma.operator.update({ where: { id: operatorId }, data: { passwordHash: newHash } });
    await this.tokens.revokeAllForOperator(operatorId, 'MANUAL_LOGOUT');
    await this.blacktape.record({
      category: 'AUTH',
      action: 'PASSWORD_CHANGED',
      actorType: 'OPERATOR',
      actorId: operatorId,
    });
  }

  async refreshSession(rawRefreshToken: string, ctx: RequestContext): Promise<IssuedTokenPair> {
    const fingerprint = fingerprintOf(ctx.ip, ctx.userAgent);
    const pair = await this.tokens.rotate(rawRefreshToken, fingerprint);
    await this.blacktape.record({ category: 'AUTH', action: 'REFRESH_SUCCESS', actorType: 'SYSTEM' });
    return pair;
  }

  async logout(operatorId: string): Promise<void> {
    await this.tokens.revokeAllForOperator(operatorId, 'MANUAL_LOGOUT');
    await this.blacktape.record({
      category: 'AUTH',
      action: 'LOGOUT',
      actorType: 'OPERATOR',
      actorId: operatorId,
    });
  }

  /**
   * Backs GET /k-id/me. The access token only carries {sub, role} (see
   * TokenService.issueTokenPair) — the frontend's AccountMenu was showing
   * a truncated operator id instead of the callsign because of that. Kept
   * intentionally minimal (callsign + role only), matching what was
   * agreed — not the full OperatorSummaryDto shape the admin list uses.
   */
  async getMe(operatorId: string): Promise<{ callsign: string; role: string }> {
    const operator = await this.prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
    return { callsign: operator.callsign, role: operator.role };
  }

  /**
   * Backs GET /k-id/operators — the admin operators list the frontend has
   * been built against since early on (AdminPage's loadOperators). Never
   * returns passwordHash/totpSecret.
   */
  async listOperators(): Promise<
    { id: string; callsign: string; email: string; role: string; totpEnabled: boolean; mfaExempt: boolean; createdAt: Date }[]
  > {
    return this.prisma.operator.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, callsign: true, email: true, role: true, totpEnabled: true, mfaExempt: true, createdAt: true },
    });
  }

  /** Backs POST /k-id/operators/:id/revoke-sessions — admin force-logout. */
  async revokeOperatorSessions(operatorId: string, revokedByOperatorId: string): Promise<void> {
    await this.tokens.revokeAllForOperator(operatorId, 'ADMIN_REVOKED');
    await this.blacktape.record({
      category: 'AUTH',
      action: 'ADMIN_REVOKED_SESSIONS',
      actorType: 'OPERATOR',
      actorId: revokedByOperatorId,
      targetType: 'Operator',
      targetId: operatorId,
    });
  }

  /**
   * Backs DELETE /k-id/operators/:id. Genuinely destructive (not a
   * soft-delete/deactivate) — Operator has no isActive/deletedAt column,
   * and adding one is a bigger decision (audit trail, re-onboarding flow)
   * than this endpoint's scope. Documented in the blacktape entry with
   * WHO deleted WHOM, at least.
   */
  async deleteOperator(operatorId: string, deletedByOperatorId: string): Promise<void> {
    const operator = await this.prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
    await this.prisma.operator.delete({ where: { id: operatorId } });
    await this.blacktape.record({
      category: 'AUTH',
      action: 'ADMIN_DELETED_OPERATOR',
      actorType: 'OPERATOR',
      actorId: deletedByOperatorId,
      targetType: 'Operator',
      targetId: operatorId,
      metadata: { deletedCallsign: operator.callsign },
    });
  }

  private dummyHashCache: string | null = null;
  private async dummyHash(): Promise<string> {
    // Precomputed lazily once per process — a fixed constant-time-ish target
    // for argon2.verify() so failed-lookup timing resembles a real check.
    if (!this.dummyHashCache) {
      this.dummyHashCache = await argon2.hash('k-apex-08-dummy-timing-guard', ARGON2ID_OPTS);
    }
    return this.dummyHashCache;
  }
}
