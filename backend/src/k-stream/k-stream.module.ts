import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SimulatorService } from './simulator.service';
import { KStreamService } from './k-stream.service';
import { KStreamController } from './k-stream.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [KStreamController],
  providers: [SimulatorService, KStreamService],
  exports: [KStreamService],
})
export class KStreamModule {}
