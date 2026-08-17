import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { CommandService } from './command.service';
import { parseTerminalCommand, NormalizedCommand } from './terminal-parser.util';

const GATEWAY_EVENTS_CHANNEL = 'kapex08:gateway:events';

interface AuthenticatedSocket extends Socket {
  data: { operatorId?: string; role?: string };
}

interface IncomingCommandPayload {
  raw?: string;
  normalized?: NormalizedCommand;
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/console' })
export class CommandsGateway implements OnGatewayConnection, OnGatewayInit {
  private readonly logger = new Logger(CommandsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly commandService: CommandService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  afterInit(): void {
    const subscriber = this.redis.duplicate();
    subscriber.subscribe(GATEWAY_EVENTS_CHANNEL).catch((err) => {
      this.logger.error(`Failed to subscribe to gateway events channel: ${(err as Error).message}`);
    });
    subscriber.on('message', (_channel, message) => {
      try {
        const { eventType, payload } = JSON.parse(message);
        this.server.emit(eventType, payload);
      } catch (err) {
        this.logger.error(`Bad gateway event message: ${(err as Error).message}`);
      }
    });
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const token = (client.handshake.auth?.token as string) ?? (client.handshake.query?.token as string);
    if (!token) {
      client.emit('auth_error', { message: 'Missing access token' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type?: string }>(token);
      if (payload.type === 'mfa_pending') throw new Error('MFA not completed');
      client.data.operatorId = payload.sub;
      client.data.role = payload.role;
      this.logger.log(`Operator ${payload.sub} connected to K-APEX-08 console`);
    } catch {
      client.emit('auth_error', { message: 'Invalid or expired access token' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('command')
  async handleCommand(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: IncomingCommandPayload,
  ): Promise<void> {
    const operatorId = client.data.operatorId;
    if (!operatorId) {
      client.emit('command_error', { message: 'Not authenticated' });
      return;
    }

    let normalized: NormalizedCommand;
    if (payload.raw) {
      const parsed = parseTerminalCommand(payload.raw);
      if (!parsed.ok || !parsed.command) {
        client.emit('command_error', { message: parsed.error ?? 'Could not parse command' });
        return;
      }
      normalized = parsed.command;
    } else if (payload.normalized) {
      normalized = payload.normalized;
    } else {
      client.emit('command_error', { message: 'No command provided' });
      return;
    }

    try {
      const result = await this.commandService.execute(normalized, operatorId, client.data.role);
      client.emit('command_result', { command: normalized, result });
    } catch (err) {
      client.emit('command_error', { message: (err as Error).message, command: normalized });
    }
  }
}
