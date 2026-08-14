import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RogueAiService } from './rogue-ai.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [RogueAiService],
  exports: [RogueAiService],
})
export class RogueAiModule {}
