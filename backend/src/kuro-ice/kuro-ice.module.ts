import { Module } from '@nestjs/common';
import { KuroIceService } from './kuro-ice.service';

@Module({
  providers: [KuroIceService],
  exports: [KuroIceService],
})
export class KuroIceModule {}
