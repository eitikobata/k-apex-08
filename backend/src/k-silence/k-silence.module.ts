import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { K_SILENCE_QUEUE, KSilenceScannerService, KSilenceRetryProcessor } from './k-silence.service';
import { KSilenceController } from './k-silence.controller';
import { KIdModule } from '../k-id/k-id.module';
import { KStreamModule } from '../k-stream/k-stream.module';

@Module({
  imports: [ScheduleModule.forRoot(), BullModule.registerQueue({ name: K_SILENCE_QUEUE }), KIdModule, KStreamModule],
  controllers: [KSilenceController],
  providers: [KSilenceScannerService, KSilenceRetryProcessor],
  exports: [KSilenceScannerService],
})
export class KSilenceModule {}
