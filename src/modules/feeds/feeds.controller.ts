import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CreateFeedDto, UpdateFeedDto } from './dto/feed.dto';
import { FeedsService } from './feeds.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/feeds')
export class AdminFeedsController {
  constructor(private readonly feeds: FeedsService) {}

  @Get()
  list() {
    return this.feeds.findAll();
  }

  @Post()
  create(@Body() dto: CreateFeedDto) {
    return this.feeds.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFeedDto) {
    return this.feeds.update(id, dto);
  }
}
