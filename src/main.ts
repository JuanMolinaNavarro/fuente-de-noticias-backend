import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);

  // Límite EXPLÍCITO del body JSON (registrado acá, antes del init, para que
  // reemplace al parser por defecto). 2 MB: holgado para el contentJson de
  // una nota larguísima, chico para un intento de agotar memoria a payloads.
  app.useBodyParser('json', { limit: '2mb' });

  configureApp(app);

  // Detrás del reverse proxy (Caddy), la IP "del cliente" que ve Express es
  // la del proxy. trust proxy hace que req.ip lea X-Forwarded-For, y así el
  // rate limiting distingue visitantes reales en vez de tratar a todo el
  // tráfico como una sola IP.
  app.set('trust proxy', 1);

  // CORS solo en desarrollo: con el patrón BFF el browser nunca llama al
  // backend directo (lo hace el servidor de Next), así que en producción no
  // hay ningún origen cruzado que permitir. No habilitarlo = menor
  // superficie. En dev sí: el frontend corre en otro puerto.
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }) });
  }

  app.enableShutdownHooks();

  // Biblioteca de medios en disco local: el backend sirve la carpeta como
  // archivos estáticos en /uploads. Con MEDIA_STORAGE=s3 esto no se usa
  // (las URLs públicas apuntan al bucket/CDN).
  if (config.get('MEDIA_STORAGE', { infer: true }) === 'local') {
    app.useStaticAssets(
      resolve(config.get('MEDIA_LOCAL_DIR', { infer: true })),
      {
        prefix: '/uploads/',
        maxAge: '365d',
        immutable: true,
      },
    );
  }

  await app.listen(config.get('PORT', { infer: true }));
}
void bootstrap();
