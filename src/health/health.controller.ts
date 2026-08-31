import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** Un chequeo de DB exitoso vale por este lapso: /health es público y cada
 *  visita NO debe costar una consulta (sería un DoS barato contra el pool
 *  de conexiones de Postgres). El healthcheck de Docker pega cada 15 s, así
 *  que con 5 s de caché sigue detectando una base caída casi al instante. */
const DB_CHECK_TTL_MS = 5_000;

// Sin @SkipThrottle: el límite global (100 req/min/IP) también aplica acá.
// El healthcheck de Docker (4 req/min desde localhost) entra holgado.
@Public()
@Controller('health')
export class HealthController {
  private lastDbOkAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    // Un health check honesto verifica la dependencia crítica (la DB),
    // no solo que el proceso esté vivo — pero cachea el éxito: los fallos
    // no se cachean, así una base caída se reporta en el acto.
    if (Date.now() - this.lastDbOkAt > DB_CHECK_TTL_MS) {
      await this.prisma.$queryRaw`SELECT 1`;
      this.lastDbOkAt = Date.now();
    }
    return { status: 'ok', database: 'up' };
  }
}
