import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MarketService } from './market.service';

/** Público: lo consume la home vía el BFF de Next. */
@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('summary')
  summary() {
    return this.market.getSummary();
  }
}

/** Admin: forzar una captura sin esperar al cron (debug, o tras un cambio). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/market')
export class AdminMarketController {
  constructor(private readonly market: MarketService) {}

  @Post('refresh')
  refresh() {
    return this.market.refresh();
  }
}
