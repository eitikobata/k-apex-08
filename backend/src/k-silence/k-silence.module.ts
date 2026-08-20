import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { KSilenceScannerService } from './k-silence.service';
import { KSilenceController } from './k-silence.controller';
import { KIdModule } from '../k-id/k-id.module';
import { KStreamModule } from '../k-stream/k-stream.module';

@Module({
  imports: [ScheduleModule.forRoot(), KIdModule, KStreamModule],
  controllers: [KSilenceController],
  providers: [KSilenceScannerService],
  exports: [KSilenceScannerService],
})
export class KSilenceModule {}
