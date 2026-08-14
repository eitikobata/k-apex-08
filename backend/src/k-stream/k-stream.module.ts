import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SimulatorService } from './simulator.service';
import { KStreamService } from './k-stream.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [SimulatorService, KStreamService],
  exports: [KStreamService],
})
export class KStreamModule {}
