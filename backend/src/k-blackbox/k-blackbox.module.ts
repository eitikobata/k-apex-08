import { Module } from '@nestjs/common';
import { KBlackboxController } from './k-blackbox.controller';
import { KBlackboxService } from './k-blackbox.service';
import { AiEnrichmentService } from './ai-enrichment.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { KIdModule } from '../k-id/k-id.module';

@Module({
  imports: [KIdModule],
  controllers: [KBlackboxController],
  providers: [KBlackboxService, AiEnrichmentService, CircuitBreakerService],
  exports: [KBlackboxService],
})
export class KBlackboxModule {}
