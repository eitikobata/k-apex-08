import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AutonomousModeService } from './autonomous-mode.service';
import { JwtAuthGuard } from '../k-id/guards/jwt-auth.guard';
import { PermissionsGuard } from '../k-id/guards/permissions.guard';
import { RequirePermissions } from '../k-id/decorators/permissions.decorator';
import { PERMISSION_SCOPES } from '../k-id/permission-scopes';
import { CurrentOperator, AuthenticatedOperator } from '../k-id/decorators/current-operator.decorator';

@Controller('k-directive')
@UseGuards(JwtAuthGuard)
export class KDirectiveController {
  constructor(private readonly autonomousMode: AutonomousModeService) {}

  @Get('autonomous-mode')
  async getState() {
    return this.autonomousMode.getState();
  }

  /**
   * The manual "GO AUTONOMOUS" / "STAND DOWN" button from the console UI.
   * Granular scope, not just role: ADMIN always passes, SENIOR_OPERATOR/
   * OPERATOR need an explicit grant (see PERMISSION_SCOPES.TOGGLE_AUTONOMOUS).
   */
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSION_SCOPES.TOGGLE_AUTONOMOUS)
  @Post('autonomous-mode/toggle')
  async toggle(@Body('active') active: boolean, @CurrentOperator() operator: AuthenticatedOperator) {
    await this.autonomousMode.manualToggle(active, operator.id);
    return { status: 'ok', active };
  }

  @Post('heartbeat')
  async heartbeat(@CurrentOperator() operator: AuthenticatedOperator) {
    await this.autonomousMode.recordOperatorHeartbeat(operator.id);
    return { status: 'ok' };
  }
}
