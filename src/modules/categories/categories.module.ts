import { Module } from '@nestjs/common';
import {
  AdminCategoriesController,
  CategoriesController,
} from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
