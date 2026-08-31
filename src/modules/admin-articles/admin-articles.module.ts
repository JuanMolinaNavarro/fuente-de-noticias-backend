import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminArticlesController } from './admin-articles.controller';
import { AdminArticlesService } from './admin-articles.service';
import { CleanupScheduler } from './cleanup.scheduler';
import { PublishScheduler } from './publish.scheduler';
import { RevisionsService } from './revisions.service';

@Module({
  // AuthModule exporta JwtModule: lo usamos para firmar tokens de vista previa
  imports: [AuthModule],
  controllers: [AdminArticlesController],
  providers: [
    AdminArticlesService,
    RevisionsService,
    PublishScheduler,
    CleanupScheduler,
  ],
  exports: [AdminArticlesService],
})
export class AdminArticlesModule {}
