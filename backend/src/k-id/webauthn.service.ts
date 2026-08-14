import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';
import type { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';

const CHALLENGE_TTL_SECONDS = 120;

/**
 * NOTE (honesty flag): this wraps @simplewebauthn/server's documented v10 API
 * faithfully, and the challenge-storage / DB-persistence plumbing around it
 * is real. What it has NOT been through is an end-to-end run against an
 * actual authenticator (YubiKey / platform biometrics) — that requires a
 * browser + real hardware, which I can't exercise here. Treat this module as
 * "implemented, needs a live device pass" before you rely on it for real login.
 */
@Injectable()
export class WebauthnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private rpID(): string {
    return this.config.get<string>('WEBAUTHN_RP_ID', 'localhost');
  }

  private rpName(): string {
    return this.config.get<string>('WEBAUTHN_RP_NAME', 'K-APEX-08');
  }

  private origin(): string {
    return this.config.get<string>('WEBAUTHN_ORIGIN', 'http://localhost:3001');
  }

  private challengeKey(operatorId: string, purpose: 'reg' | 'auth'): string {
    return `webauthn:challenge:${purpose}:${operatorId}`;
  }

  async generateRegistrationOptionsFor(operatorId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const operator = await this.prisma.operator.findUniqueOrThrow({
      where: { id: operatorId },
      include: { webauthnDevices: true },
    });

    const options = await generateRegistrationOptions({
      rpName: this.rpName(),
      rpID: this.rpID(),
      userName: operator.callsign,
      userDisplayName: operator.callsign,
      attestationType: 'none',
      excludeCredentials: operator.webauthnDevices.map((d) => ({ id: d.credentialId })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    await this.redis.set(this.challengeKey(operatorId, 'reg'), options.challenge, 'EX', CHALLENGE_TTL_SECONDS);
    return options;
  }

  async verifyRegistration(
    operatorId: string,
    response: RegistrationResponseJSON,
    deviceLabel?: string,
  ): Promise<VerifiedRegistrationResponse> {
    const expectedChallenge = await this.redis.get(this.challengeKey(operatorId, 'reg'));
    if (!expectedChallenge) {
      throw new UnauthorizedException('WebAuthn registration challenge expired or not found');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin(),
      expectedRPID: this.rpID(),
    });

    if (verification.verified && verification.registrationInfo) {
      const info = verification.registrationInfo;
      await this.prisma.webauthnCredential.create({
        data: {
          operatorId,
          credentialId: info.credentialID,
          publicKey: Buffer.from(info.credentialPublicKey),
          counter: BigInt(info.counter),
          deviceLabel,
        },
      });
      await this.redis.del(this.challengeKey(operatorId, 'reg'));
    }

    return verification;
  }

  async generateAuthenticationOptionsFor(operatorId: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const devices = await this.prisma.webauthnCredential.findMany({ where: { operatorId } });

    const options = await generateAuthenticationOptions({
      rpID: this.rpID(),
      allowCredentials: devices.map((d) => ({ id: d.credentialId })),
      userVerification: 'preferred',
    });

    await this.redis.set(this.challengeKey(operatorId, 'auth'), options.challenge, 'EX', CHALLENGE_TTL_SECONDS);
    return options;
  }

  async verifyAuthentication(
    operatorId: string,
    response: AuthenticationResponseJSON,
  ): Promise<VerifiedAuthenticationResponse> {
    const expectedChallenge = await this.redis.get(this.challengeKey(operatorId, 'auth'));
    if (!expectedChallenge) {
      throw new UnauthorizedException('WebAuthn authentication challenge expired or not found');
    }

    const credential = await this.prisma.webauthnCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!credential || credential.operatorId !== operatorId) {
      throw new UnauthorizedException('Unknown WebAuthn credential');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin(),
      expectedRPID: this.rpID(),
      authenticator: {
        credentialID: credential.credentialId,
        credentialPublicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
      },
    });

    if (verification.verified) {
      await this.prisma.webauthnCredential.update({
        where: { id: credential.id },
        data: { counter: BigInt(verification.authenticationInfo.newCounter) },
      });
      await this.redis.del(this.challengeKey(operatorId, 'auth'));
    }

    return verification;
  }
}
