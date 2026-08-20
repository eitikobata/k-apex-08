import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { KIdService } from './k-id.service';
import { WebauthnService } from './webauthn.service';
import { PermissionsService } from './permissions.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterOperatorDto } from './dto/register-operator.dto';
import { VerifyTotpSetupDto } from './dto/verify-totp-setup.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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
    private readonly permissions: PermissionsService,
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
  @Get('me')
  async me(@CurrentOperator() operator: AuthenticatedOperator) {
    return this.kId.getMe(operator.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('password')
  async changePassword(
    @CurrentOperator() operator: AuthenticatedOperator,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.kId.changePassword(operator.id, dto.currentPassword, dto.newPassword);
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

  // --- Admin operator management -----------------------------------------
  // Frontend (admin/page.tsx) has been built against these three since
  // early on — never actually existed on the backend until now.

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('operators')
  async listOperators() {
    return this.kId.listOperators();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('operators/:id/revoke-sessions')
  async revokeOperatorSessions(@Param('id') operatorId: string, @CurrentOperator() operator: AuthenticatedOperator) {
    await this.kId.revokeOperatorSessions(operatorId, operator.id);
    return { status: 'ok' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('operators/:id')
  async deleteOperator(@Param('id') operatorId: string, @CurrentOperator() operator: AuthenticatedOperator) {
    if (operatorId === operator.id) {
      throw new BadRequestException('Cannot delete your own account while logged in as it.');
    }
    await this.kId.deleteOperator(operatorId, operator.id);
    return { status: 'ok' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('operators/:id/password')
  async adminResetPassword(
    @Param('id') operatorId: string,
    @Body('newPassword') newPassword: string,
    @CurrentOperator() operator: AuthenticatedOperator,
  ) {
    await this.kId.adminResetPassword(operatorId, newPassword, operator.id);
    return { status: 'ok' };
  }

  // --- Granular permission management (ADMIN only) -----------------------
  // These sit alongside role-based access: role decides the broad strokes
  // (who can even try), a granted scope decides the fine ones (who can
  // approve SHATTER specifically). See src/k-id/permission-scopes.ts.

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('operators/:id/permissions')
  async listPermissions(@Param('id') operatorId: string) {
    return { scopes: await this.permissions.list(operatorId) };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('operators/:id/permissions')
  async grantPermission(
    @Param('id') operatorId: string,
    @Body('scope') scope: string,
    @CurrentOperator() admin: AuthenticatedOperator,
  ) {
    await this.permissions.grant(operatorId, scope, admin.id);
    return { status: 'ok' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('operators/:id/permissions/:scope')
  async revokePermission(
    @Param('id') operatorId: string,
    @Param('scope') scope: string,
    @CurrentOperator() admin: AuthenticatedOperator,
  ) {
    await this.permissions.revoke(operatorId, scope, admin.id);
    return { status: 'ok' };
  }
}
