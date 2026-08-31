import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { HomeModule } from './modules/home/home.module';
import { HealthController } from './health/health.controller';
import { AdminArticlesModule } from './modules/admin-articles/admin-articles.module';
import { AuditModule } from './modules/audit/audit.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { FeedsModule } from './modules/feeds/feeds.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { MediaModule } from './modules/media/media.module';
import { MarketModule } from './modules/market/market.module';
import { UsersModule } from './modules/users/users.module';
import { WeatherModule } from './modules/weather/weather.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Rate limiting global: 100 requests por minuto por IP. Protege de bots
    // y scrapers agresivos; el login tiene un límite mucho más estricto
    // (@Throttle en AuthController) contra fuerza bruta de contraseñas.
    // Ojo: ttl se expresa en milisegundos, por eso el helper seconds().
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: seconds(60), limit: 100 }],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    ArticlesModule,
    WeatherModule,
    UsersModule,
    AuthModule,
    AdminArticlesModule,
    CategoriesModule,
    FeedsModule,
    IngestModule,
    MarketModule,
    MediaModule,
    HomeModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard global: el throttler aplica a todos los endpoints sin tener que
    // recordar ponerlo en cada controller (los olvidos son la fuente típica
    // de agujeros). Se exceptúa con @SkipThrottle donde corresponde.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Autenticación con el mismo criterio: TODO endpoint exige token salvo
    // que esté marcado @Public(). El default es "cerrado" — un controller
    // nuevo sin decorador no puede quedar abierto por olvido.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
