import { Module } from '@nestjs/common';
import { FeedsModule } from '../feeds/feeds.module';
import { FeedParserAdapter } from './feed-parser.adapter';
import { ImageExtractor } from './image-extractor';
import { IngestController } from './ingest.controller';
import { IngestScheduler } from './ingest.scheduler';
import { IngestService } from './ingest.service';

@Module({
  imports: [FeedsModule],
  controllers: [IngestController],
  providers: [
    IngestService,
    IngestScheduler,
    FeedParserAdapter,
    ImageExtractor,
  ],
})
export class IngestModule {}
