import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { WeatherService } from './weather.service';

/** Público: el clima del masthead. */
@Public()
@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  current() {
    return this.weather.getCurrent();
  }
}
