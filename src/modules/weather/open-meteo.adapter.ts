import { Injectable } from '@nestjs/common';
import { CurrentWeather, WeatherProviderPort } from './weather.port';

// San Miguel de Tucumán — mismas coordenadas que usaba el frontend
const URL =
  'https://api.open-meteo.com/v1/forecast?latitude=-26.81&longitude=-65.22&current=temperature_2m,weather_code';

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
}

@Injectable()
export class OpenMeteoAdapter implements WeatherProviderPort {
  async getCurrent(): Promise<CurrentWeather> {
    const res = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Open-Meteo respondió ${res.status}`);
    }
    const json = (await res.json()) as OpenMeteoResponse;
    const temperature = json.current?.temperature_2m;
    const weatherCode = json.current?.weather_code;
    if (typeof temperature !== 'number' || typeof weatherCode !== 'number') {
      throw new Error('Respuesta de Open-Meteo sin datos de clima');
    }
    return { temperature, weatherCode };
  }
}
