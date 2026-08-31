import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

/**
 * Configuración compartida entre main.ts y los tests e2e:
 * si prod y tests configuran la app por caminos distintos, los tests
 * terminan probando otra aplicación.
 */
export function configureApp(app: INestApplication): void {
  // Headers de seguridad estándar (nosniff, frame-deny, HSTS, etc.).
  // Override de Cross-Origin-Resource-Policy: el default "same-origin"
  // impediría que el frontend en :3000 muestre las imágenes de /uploads
  // servidas desde :4000 en desarrollo (orígenes distintos). En producción
  // todo va detrás del mismo dominio vía Caddy, pero /uploads es contenido
  // público: relajarlo no debilita nada.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Un campo desconocido es 400 con mensaje, no descarte mudo: los typos
      // del cliente se ven en el acto y un intento de mass assignment recibe
      // un rechazo explícito en vez de "funcionar" en silencio.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
}
