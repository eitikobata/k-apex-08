import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const GCM_IV_BYTES = 12; // standard/recommended IV size for GCM

@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);

  constructor(private readonly config: ConfigService) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(operatorEmail: string, secret: string): string {
    const issuer = this.config.get<string>('TOTP_ISSUER', 'Kobata Matrix Corporation');
    return authenticator.keyuri(operatorEmail, issuer, secret);
  }

  verify(token: string, secret: string): boolean {
    if (this.isDevBypassActive()) {
      this.logger.warn(`⚠ TOTP DEV BYPASS active — code "${token}" accepted without real verification`);
      return true;
    }

    try {
      return authenticator.verify({ token, secret });
    } catch {
      // otplib throws on malformed token input (e.g. non-numeric) — treat as invalid, not a crash.
      return false;
    }
  }

  /**
   * Encrypts a TOTP secret for storage (AES-256-GCM). Call sites in
   * k-id.service.ts are explicit about when they're handling plaintext
   * vs. encrypted — this method and decryptSecret() below don't hide that
   * behind verify()/keyUri() themselves, since one legitimate call site
   * (right after generateSecret(), before anything is ever written to the
   * DB) genuinely needs the plaintext and would be awkward to force
   * through an encrypt-then-immediately-decrypt round trip.
   *
   * Stored format: `base64(iv):base64(authTag):base64(ciphertext)` — plain
   * colon delimiters are safe here since none of the three base64 parts
   * can ever contain a literal `:`.
   */
  encryptSecret(plaintextSecret: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(GCM_IV_BYTES);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextSecret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  /** Inverse of encryptSecret(). Throws (not returns null) on a malformed
   * or tampered value — a TOTP secret that fails to decrypt cleanly should
   * never be silently treated as "no secret," which would look like an
   * un-enrolled account instead of a data-integrity problem. */
  decryptSecret(stored: string): string {
    const key = this.getEncryptionKey();
    const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new InternalServerErrorException('Stored TOTP secret is not in the expected encrypted format');
    }
    try {
      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
      return plaintext.toString('utf8');
    } catch (err) {
      throw new InternalServerErrorException(`Failed to decrypt stored TOTP secret: ${(err as Error).message}`);
    }
  }

  private getEncryptionKey(): Buffer {
    const keyB64 = this.config.get<string>('TOTP_ENCRYPTION_KEY');
    if (!keyB64) {
      throw new InternalServerErrorException(
        'TOTP_ENCRYPTION_KEY is not set — cannot encrypt/decrypt TOTP secrets. Generate one with: openssl rand -base64 32',
      );
    }
    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        `TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256 (got ${key.length}). Generate one with: openssl rand -base64 32`,
      );
    }
    return key;
  }

  private isDevBypassActive(): boolean {
    const bypassEnabled = this.config.get<string>('AUTH_DEV_MFA_BYPASS') === 'true';
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    return bypassEnabled && !isProduction;
  }
}
