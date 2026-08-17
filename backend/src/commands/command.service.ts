import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { KDirectiveService } from '../k-directive/k-directive.service';
import { AutonomousModeService } from '../k-directive/autonomous-mode.service';
import { RogueAiService } from '../rogue-ai/rogue-ai.service';
import { NormalizedCommand } from './terminal-parser.util';

/**
 * The single entry point both the xterm.js terminal parser and the UI's
 * buttons funnel through. Nothing in the frontend should ever call a
 * domain service directly — everything goes through here, so "every button
 * has an equivalent command" holds by construction, not by convention.
 */
@Injectable()
export class CommandService {
  constructor(
    private readonly kDirective: KDirectiveService,
    private readonly autonomousMode: AutonomousModeService,
    private readonly rogueAi: RogueAiService,
  ) {}

  async execute(
    command: NormalizedCommand,
    operatorId: string,
    operatorRole?: string,
  ): Promise<Record<string, unknown>> {
    // OBSERVER = "só olhar, não mexe" — sem exceção, em nenhum comando.
    if (operatorRole === 'OBSERVER') {
      throw new ForbiddenException('Observers cannot issue commands — read-only access');
    }

    switch (command.type) {
      case 'CONFIRM_KURO_ICE_ACTION':
        await this.kDirective.confirmByOperator(command.incidentId, operatorId);
        return { status: 'ok', incidentId: command.incidentId };

      case 'ROGUE_AI_COMMAND': {
        const result = await this.rogueAi.issueCommand(command.rogueAiIncidentId, command.command, operatorId);
        return { status: 'ok', ...result };
      }

      case 'AUTONOMOUS_TOGGLE':
        await this.autonomousMode.manualToggle(command.active, operatorId);
        return { status: 'ok', active: command.active };

      default:
        throw new BadRequestException('Unknown command type');
    }
  }
}
