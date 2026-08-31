import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketService } from './market.service';

@Injectable()
export class MarketScheduler {
  private readonly logger = new Logger(MarketScheduler.name);

  constructor(private readonly market: MarketService) {}

  /**
   * Cada 15 min, en punto (:00, :15, :30, :45). Si cambiás esto, cambiá
   * también REFRESH_INTERVAL_MS en el service: es el criterio de "dato fresco".
   */
  @Cron('*/15 * * * *')
  async handleCron() {
    try {
      await this.market.refresh();
    } catch (error) {
      this.logger.warn(`Actualización de mercado omitida: ${String(error)}`);
    }
  }
}
