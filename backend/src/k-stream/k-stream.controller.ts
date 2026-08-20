import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { KStreamService } from './k-stream.service';
import { JwtAuthGuard } from '../k-id/guards/jwt-auth.guard';
import { RolesGuard } from '../k-id/guards/roles.guard';
import { Roles } from '../k-id/decorators/roles.decorator';

type DebugIncidentType = 'LATCH' | 'SPLICE' | 'SHATTER' | 'ROGUE_AI';
const VALID_TYPES: DebugIncidentType[] = ['LATCH', 'SPLICE', 'SHATTER', 'ROGUE_AI'];

@Controller('k-stream')
@UseGuards(JwtAuthGuard)
export class KStreamController {
  constructor(private readonly kStream: KStreamService) {}

  @Get('incidents')
  async listIncidents() {
    return this.kStream.listIncidents();
  }

  /**
   * Admin-only testing utility — forces an incident into the pipeline
   * without waiting on SimulatorService's random ticks. Goes through the
   * exact same INCIDENTS_STREAM -> K-DIRECTIVE routing as an organically
   * detected one, so operator notification, autonomous-mode handling, and
   * Rogue AI containment all behave identically. Never exposed past
   * ADMIN — this is a debug/demo tool, not something a real operator
   * should be able to spam.
   */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('debug/inject')
  async inject(@Body('type') type: DebugIncidentType) {
    if (!VALID_TYPES.includes(type)) {
      throw new BadRequestException(`type must be one of ${VALID_TYPES.join(', ')}`);
    }
    return this.kStream.debugInjectIncident(type);
  }
}
