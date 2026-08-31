import { Module } from '@nestjs/common';
import { OpenMeteoAdapter } from './open-meteo.adapter';
import { WeatherController } from './weather.controller';
import { WEATHER_PROVIDER } from './weather.port';
import { WeatherService } from './weather.service';

@Module({
  controllers: [WeatherController],
  providers: [
    WeatherService,
    // Acá se decide QUÉ implementación cumple el puerto (inversión de dependencias):
    // cambiar de proveedor de clima es cambiar solo esta línea.
    { provide: WEATHER_PROVIDER, useClass: OpenMeteoAdapter },
  ],
})
export class WeatherModule {}
