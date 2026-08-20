import { Global, Module } from '@nestjs/common';
import { BlacktapeService } from './blacktape.service';
import { BlacktapeController } from './blacktape.controller';
import { KIdModule } from '../../k-id/k-id.module';

@Global()
@Module({
  imports: [KIdModule],
  controllers: [BlacktapeController],
  providers: [BlacktapeService],
  exports: [BlacktapeService],
})
export class BlacktapeModule {}
