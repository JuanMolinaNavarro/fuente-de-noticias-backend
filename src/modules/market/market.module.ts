import { Module } from '@nestjs/common';
import { AdminMarketController, MarketController } from './market.controller';
import { MARKET_SOURCES } from './market.port';
import type { MarketSourcePort } from './market.port';
import { MarketScheduler } from './market.scheduler';
import { MarketService } from './market.service';
import { ArgentinaDatosAdapter } from './sources/argentina-datos.adapter';
import { DolarApiAdapter } from './sources/dolarapi.adapter';
import { YahooFinanceAdapter } from './sources/yahoo-finance.adapter';

@Module({
  controllers: [MarketController, AdminMarketController],
  providers: [
    MarketService,
    MarketScheduler,
    DolarApiAdapter,
    ArgentinaDatosAdapter,
    YahooFinanceAdapter,
    // Acá se decide QUÉ fuentes alimentan al módulo. Nest no tiene
    // "multi-providers" nativos, así que armamos el array con una factory:
    // agregar/quitar una fuente es tocar solo esta lista.
    {
      provide: MARKET_SOURCES,
      inject: [DolarApiAdapter, ArgentinaDatosAdapter, YahooFinanceAdapter],
      useFactory: (...sources: MarketSourcePort[]) => sources,
    },
  ],
})
export class MarketModule {}
