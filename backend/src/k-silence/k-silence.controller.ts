import { Controller, Get, UseGuards } from '@nestjs/common';
import { KSilenceScannerService } from './k-silence.service';
import { JwtAuthGuard } from '../k-id/guards/jwt-auth.guard';

@Controller('k-silence')
@UseGuards(JwtAuthGuard)
export class KSilenceController {
  constructor(private readonly kSilence: KSilenceScannerService) {}

  @Get('nodes')
  async listNodes() {
    return this.kSilence.listNodes();
  }
}
