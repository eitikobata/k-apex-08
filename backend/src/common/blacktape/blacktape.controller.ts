import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BlacktapeCategory, BlacktapeService } from './blacktape.service';
import { JwtAuthGuard } from '../../k-id/guards/jwt-auth.guard';

const VALID_CATEGORIES: BlacktapeCategory[] = ['AUTH', 'INCIDENT', 'KURO_ICE', 'K_SILENCE', 'K_DIRECTIVE', 'ROGUE_AI'];

@Controller('k-blacktape')
@UseGuards(JwtAuthGuard)
export class BlacktapeController {
  constructor(private readonly blacktape: BlacktapeService) {}

  @Get('entries')
  async listEntries(
    @Query('category') category?: string,
    @Query('beforeCreatedAt') beforeCreatedAt?: string,
    @Query('beforeId') beforeId?: string,
    @Query('limit') limit?: string,
  ) {
    const normalized = category && VALID_CATEGORIES.includes(category as BlacktapeCategory) ? (category as BlacktapeCategory) : undefined;
    const before = beforeCreatedAt && beforeId ? { createdAt: new Date(beforeCreatedAt), id: beforeId } : undefined;
    return this.blacktape.listEntries({
      category: normalized,
      before,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
