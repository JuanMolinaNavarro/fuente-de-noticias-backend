import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { HomeZone } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { HomeService } from './home.service';

export class SetSlotsDto {
  @IsEnum(HomeZone)
  zone!: HomeZone;

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  articleIds!: string[];
}

/** Portada pública: una sola llamada para toda la home. */
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  portada() {
    return this.home.resolvePublic();
  }
}

/** Curación de portada: EDITOR y ADMIN. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'EDITOR')
@Controller('admin/home')
export class AdminHomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  draft() {
    return this.home.getDraft();
  }

  @Put('slots')
  setSlots(@Body() dto: SetSlotsDto, @CurrentUser() user: AuthUser) {
    return this.home.setSlots(dto.zone, dto.articleIds, user.id);
  }

  @Post('publish')
  publish(@CurrentUser() user: AuthUser) {
    return this.home.publish(user.id);
  }

  @Get('versions')
  versions() {
    return this.home.versions();
  }

  @Post('versions/:id/republish')
  republish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.home.republish(id, user.id);
  }
}
