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

  /** The manual "GO AUTONOMOUS" / "STAND DOWN" button from the console UI. */
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
