import { Controller, Get } from '@nestjs/common';
import { WeatherService } from './weather.service';

@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  current() {
    return this.weather.getCurrent();
  }
}
