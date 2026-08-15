import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { KDirectiveController } from './k-directive.controller';
import { KDirectiveService } from './k-directive.service';
import { AutonomousModeService } from './autonomous-mode.service';
import { KIdModule } from '../k-id/k-id.module';
import { KuroIceModule } from '../kuro-ice/kuro-ice.module';
import { RogueAiModule } from '../rogue-ai/rogue-ai.module';
import { KBlackboxModule } from '../k-blackbox/k-blackbox.module';

@Module({
  imports: [ScheduleModule.forRoot(), KIdModule, KuroIceModule, RogueAiModule, KBlackboxModule],
  controllers: [KDirectiveController],
  providers: [KDirectiveService, AutonomousModeService],
  exports: [AutonomousModeService, KDirectiveService],
})
export class KDirectiveModule {}
