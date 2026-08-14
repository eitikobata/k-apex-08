import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { KBlackboxService } from './k-blackbox.service';
import { JwtAuthGuard } from '../k-id/guards/jwt-auth.guard';

@Controller('k-blackbox')
@UseGuards(JwtAuthGuard)
export class KBlackboxController {
  constructor(private readonly blackbox: KBlackboxService) {}

  @Post('cases/:incidentId/summarize')
  async summarize(@Param('incidentId') incidentId: string) {
    return this.blackbox.requestAiSummary(incidentId);
  }

  @Get('cases/:incidentId/replay')
  async replay(@Param('incidentId') incidentId: string) {
    return this.blackbox.replayIncident(incidentId);
  }

  @Post('cases/search')
  async search(@Body('embedding') embedding: number[], @Body('limit') limit?: number) {
    return this.blackbox.findSimilarCases(embedding, limit);
  }
}
