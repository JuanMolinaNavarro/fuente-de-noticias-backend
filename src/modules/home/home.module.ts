import { Module } from '@nestjs/common';
import { AdminHomeController, HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  controllers: [HomeController, AdminHomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
