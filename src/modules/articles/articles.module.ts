import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';

@Module({
  // AuthModule exporta JwtModule: verifica los tokens de vista previa
  imports: [AuthModule],
  controllers: [ArticlesController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
