import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { K_SILENCE_QUEUE, KSilenceScannerService, KSilenceRetryProcessor } from './k-silence.service';

@Module({
  imports: [ScheduleModule.forRoot(), BullModule.registerQueue({ name: K_SILENCE_QUEUE })],
  providers: [KSilenceScannerService, KSilenceRetryProcessor],
  exports: [KSilenceScannerService],
})
export class KSilenceModule {}
