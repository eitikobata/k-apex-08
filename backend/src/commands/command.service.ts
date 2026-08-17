import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { KDirectiveService } from '../k-directive/k-directive.service';
import { AutonomousModeService } from '../k-directive/autonomous-mode.service';
import { RogueAiService } from '../rogue-ai/rogue-ai.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { PermissionsService } from '../k-id/permissions.service';
import { PERMISSION_SCOPES } from '../k-id/permission-scopes';
import { NormalizedCommand } from './terminal-parser.util';

/**
 * The single entry point both the xterm.js terminal parser and the UI's
 * buttons funnel through. Nothing in the frontend should ever call a
 * domain service directly — everything goes through here, so "every button
 * has an equivalent command" holds by construction, not by convention.
 *
 * Two layers of access control, checked in order:
 *  1. Role: OBSERVER can never issue any command, full stop.
 *  2. Granular scope: SENIOR_OPERATOR/OPERATOR additionally need an
 *     explicit permission grant for the specific critical action (ADMIN
 *     bypasses this layer — see PermissionsService).
 */
@Injectable()
export class CommandService {
  constructor(
    private readonly kDirective: KDirectiveService,
    private readonly autonomousMode: AutonomousModeService,
    private readonly rogueAi: RogueAiService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async execute(
    command: NormalizedCommand,
    operatorId: string,
    operatorRole?: string,
  ): Promise<Record<string, unknown>> {
    if (operatorRole === 'OBSERVER') {
      throw new ForbiddenException('Observers cannot issue commands — read-only access');
    }

    switch (command.type) {
      case 'CONFIRM_KURO_ICE_ACTION': {
        const incident = await this.prisma.incident.findUniqueOrThrow({ where: { id: command.incidentId } });
        const scope =
          incident.tier === 'SHATTER' ? PERMISSION_SCOPES.APPROVE_SHATTER : PERMISSION_SCOPES.APPROVE_SPLICE;
        await this.requirePermission(operatorId, operatorRole, scope);
        await this.kDirective.confirmByOperator(command.incidentId, operatorId);
        return { status: 'ok', incidentId: command.incidentId };
      }

      case 'ROGUE_AI_COMMAND': {
        await this.requirePermission(operatorId, operatorRole, PERMISSION_SCOPES.ROGUE_AI_COMMAND);
        const result = await this.rogueAi.issueCommand(command.rogueAiIncidentId, command.command, operatorId);
        return { status: 'ok', ...result };
      }

      case 'AUTONOMOUS_TOGGLE':
        await this.requirePermission(operatorId, operatorRole, PERMISSION_SCOPES.TOGGLE_AUTONOMOUS);
        await this.autonomousMode.manualToggle(command.active, operatorId);
        return { status: 'ok', active: command.active };

      default:
        throw new BadRequestException('Unknown command type');
    }
  }

  private async requirePermission(operatorId: string, role: string | undefined, scope: string): Promise<void> {
    const allowed = await this.permissions.hasPermission(operatorId, role ?? '', scope);
    if (!allowed) {
      throw new ForbiddenException(`Missing permission: ${scope}`);
    }
  }
}
