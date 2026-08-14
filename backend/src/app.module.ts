import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { BlacktapeModule } from './common/blacktape/blacktape.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { KIdModule } from './k-id/k-id.module';
import { KStreamModule } from './k-stream/k-stream.module';
import { KSilenceModule } from './k-silence/k-silence.module';
import { KDirectiveModule } from './k-directive/k-directive.module';
import { KuroIceModule } from './kuro-ice/kuro-ice.module';
import { RogueAiModule } from './rogue-ai/rogue-ai.module';
import { KBlackboxModule } from './k-blackbox/k-blackbox.module';
import { CommandsModule } from './commands/commands.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          db: config.get<number>('REDIS_DB', 0),
        },
        prefix: config.get<string>('REDIS_KEY_PREFIX', 'kapex08:') + 'bullmq',
      }),
    }),
    PrismaModule,
    RedisModule,
    BlacktapeModule,
    OutboxModule,
    IdempotencyModule,
    KIdModule,
    KStreamModule,
    KSilenceModule,
    KDirectiveModule,
    KuroIceModule,
    RogueAiModule,
    KBlackboxModule,
    CommandsModule,
  ],
})
export class AppModule {}
