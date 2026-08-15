import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';

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

  private isDevBypassActive(): boolean {
    const bypassEnabled = this.config.get<string>('AUTH_DEV_MFA_BYPASS') === 'true';
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    return bypassEnabled && !isProduction;
  }
}`
`