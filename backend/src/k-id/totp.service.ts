import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';

@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(operatorEmail: string, secret: string): string {
    const issuer = this.config.get<string>('TOTP_ISSUER', 'Kobata Matrix Corporation');
    return authenticator.keyuri(operatorEmail, issuer, secret);
  }

  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      // otplib throws on malformed token input (e.g. non-numeric) — treat as invalid, not a crash.
      return false;
    }
  }
}
