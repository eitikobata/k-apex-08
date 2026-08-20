import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { KBlackboxService } from './k-blackbox.service';
import { JwtAuthGuard } from '../k-id/guards/jwt-auth.guard';
import { RolesGuard } from '../k-id/guards/roles.guard';
import { Roles } from '../k-id/decorators/roles.decorator';

@Controller('k-blackbox')
@UseGuards(JwtAuthGuard)
export class KBlackboxController {
  constructor(private readonly blackbox: KBlackboxService) {}

  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SENIOR_OPERATOR', 'OPERATOR')
  @Post('cases/:incidentId/summarize')
  async summarize(@Param('incidentId') incidentId: string) {
    return this.blackbox.requestAiSummary(incidentId);
  }

  @Get('cases/:incidentId/replay')
  async replay(@Param('incidentId') incidentId: string) {
    return this.blackbox.replayIncident(incidentId);
  }

  @Get('cases')
  async listCases() {
    return this.blackbox.listCases();
  }

  @Post('cases/search')
  async search(@Body('embedding') embedding: number[], @Body('limit') limit?: number) {
    return this.blackbox.findSimilarCases(embedding, limit);
  }

  @Post('cases/search-by-text')
  async searchByText(@Body('query') query: string, @Body('limit') limit?: number) {
    return this.blackbox.searchCasesByText(query, limit);
  }
}
