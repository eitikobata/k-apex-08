import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KIdController } from './k-id.controller';
import { KIdService } from './k-id.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { RateLimitService } from './rate-limit.service';
import { WebauthnService } from './webauthn.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_TTL', '900s') },
      }),
    }),
  ],
  controllers: [KIdController],
  providers: [
    KIdService,
    TokenService,
    TotpService,
    RateLimitService,
    WebauthnService,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [KIdService, TokenService, JwtAuthGuard, RolesGuard, PermissionsGuard, JwtModule],
})
export class KIdModule {}
