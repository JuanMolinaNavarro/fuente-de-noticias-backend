import { Module } from '@nestjs/common';
import { AdminFeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';

@Module({
  controllers: [AdminFeedsController],
  providers: [FeedsService],
  exports: [FeedsService], // la ingesta lee los feeds habilitados desde acá
})
export class FeedsModule {}
