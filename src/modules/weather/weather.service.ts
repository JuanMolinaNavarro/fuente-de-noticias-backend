import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { WEATHER_PROVIDER } from './weather.port';
import type { CurrentWeather, WeatherProviderPort } from './weather.port';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min, igual que el revalidate del frontend

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private cache: { data: CurrentWeather; fetchedAt: number } | null = null;

  constructor(
    @Inject(WEATHER_PROVIDER) private readonly provider: WeatherProviderPort,
  ) {}

  async getCurrent(): Promise<CurrentWeather> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.data;
    }
    try {
      const data = await this.provider.getCurrent();
      this.cache = { data, fetchedAt: now };
      return data;
    } catch (error) {
      this.logger.warn(`No se pudo obtener el clima: ${String(error)}`);
      // Si hay un cache vencido, mejor dato viejo que error
      if (this.cache) return this.cache.data;
      throw new BadGatewayException('Servicio de clima no disponible');
    }
  }
}
