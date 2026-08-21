import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AutonomousModeService } from './autonomous-mode.service';
import { JwtAuthGuard } from '../k-id/guards/jwt-auth.guard';
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
   * NOTE (deliberate policy change): this used to require the granular
   * TOGGLE_AUTONOMOUS scope (ADMIN bypassed automatically, everyone else
   * needed an explicit grant). Unlocked for every authenticated rank —
   * OBSERVER included — by request: JwtAuthGuard alone is the gate now,
   * no PermissionsGuard/RequirePermissions on this route. Note this is
   * narrower than "OBSERVER can act generally" — CommandService still
   * blocks OBSERVER from every terminal-typed command (CONFIRM, ISOLATE,
   * TRACE, PURGE); this route was never routed through CommandService in
   * the first place, so that restriction was never touching it anyway.
   */
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
