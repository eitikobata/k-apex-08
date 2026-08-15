import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RogueAiService } from './rogue-ai.service';
import { KBlackboxModule } from '../k-blackbox/k-blackbox.module';

@Module({
  imports: [ScheduleModule.forRoot(), KBlackboxModule],
  providers: [RogueAiService],
  exports: [RogueAiService],
})
export class RogueAiModule {}
