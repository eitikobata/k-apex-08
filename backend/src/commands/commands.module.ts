import { Module } from '@nestjs/common';
import { CommandService } from './command.service';
import { CommandsGateway } from './commands.gateway';
import { KDirectiveModule } from '../k-directive/k-directive.module';
import { RogueAiModule } from '../rogue-ai/rogue-ai.module';
import { KIdModule } from '../k-id/k-id.module';

@Module({
  imports: [KDirectiveModule, RogueAiModule, KIdModule],
  providers: [CommandService, CommandsGateway],
  exports: [CommandService],
})
export class CommandsModule {}
