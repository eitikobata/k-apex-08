import { Global, Module } from '@nestjs/common';
import { BlacktapeService } from './blacktape.service';

@Global()
@Module({
  providers: [BlacktapeService],
  exports: [BlacktapeService],
})
export class BlacktapeModule {}
