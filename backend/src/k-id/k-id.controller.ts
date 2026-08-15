import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { KIdService } from './k-id.service';
import { WebauthnService } from './webauthn.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterOperatorDto } from './dto/register-operator.dto';
import { VerifyTotpSetupDto } from './dto/verify-totp-setup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentOperator, AuthenticatedOperator } from './decorators/current-operator.decorator';

function requestContext(req: Request) {
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.headers['user-agent'] ?? 'unknown',
  };
}

@Controller('k-id')
export class KIdController {
  constructor(
    private readonly kId: KIdService,
    private readonly webauthn: WebauthnService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('operators')
  async registerOperator(@Body() dto: RegisterOperatorDto) {
    return this.kId.registerOperator(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.kId.loginStep1(dto.callsign, dto.password, requestContext(req));
  }

  @Post('login/totp')
  async completeLoginWithTotp(@Body() dto: VerifyMfaDto, @Req() req: Request) {
    return this.kId.completeLoginWithTotp(dto.mfaPendingToken, dto.totpCode, requestContext(req));
  }

  @Post('totp/setup-confirm')
  async confirmTotpSetup(@Body() dto: VerifyTotpSetupDto, @Req() req: Request) {
    return this.kId.completeTotpSetup(dto.totpSetupToken, dto.totpCode, requestContext(req));
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.kId.refreshSession(dto.refreshToken, requestContext(req));
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentOperator() operator: AuthenticatedOperator) {
    await this.kId.logout(operator.id);
    return { status: 'ok' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('webauthn/registration-options')
  async webauthnRegistrationOptions(@CurrentOperator() operator: AuthenticatedOperator) {
    return this.webauthn.generateRegistrationOptionsFor(operator.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('webauthn/registration-verify')
  async webauthnRegistrationVerify(
    @CurrentOperator() operator: AuthenticatedOperator,
    @Body('response') response: never,
    @Body('deviceLabel') deviceLabel?: string,
  ) {
    return this.webauthn.verifyRegistration(operator.id, response, deviceLabel);
  }
}
