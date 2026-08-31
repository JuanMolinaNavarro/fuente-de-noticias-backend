import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { releaseScheduled } from '../../domain/article-state';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Publicación programada: cada minuto libera las notas SCHEDULED cuya hora
 * ya pasó. Mismo molde que IngestScheduler (cron in-process).
 *
 * El "claim" es atómico por nota: updateMany con la condición status=SCHEDULED
 * en el WHERE. Si algún día corren dos instancias, sólo una gana la fila
 * (count=1) y la otra ve count=0 y la saltea: no se publica dos veces.
 */
@Injectable()
export class PublishScheduler {
  private readonly logger = new Logger(PublishScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    try {
      const n = await this.releaseDue();
      if (n > 0) this.logger.log(`Publicadas ${n} notas programadas`);
    } catch (error) {
      this.logger.error(`Error liberando programadas: ${String(error)}`);
    }
  }

  /** Publica las programadas vencidas. Devuelve cuántas liberó. Pública para tests. */
  async releaseDue(now = new Date()): Promise<number> {
    const vencidas = await this.prisma.article.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        firstPublishedAt: true,
      },
    });
    let liberadas = 0;
    for (const a of vencidas) {
      const data = releaseScheduled(a, now); // regla de dominio (fechas)
      const r = await this.prisma.article.updateMany({
        where: { id: a.id, status: 'SCHEDULED' }, // claim atómico
        data,
      });
      if (r.count === 1) {
        liberadas++;
        await this.audit.log({
          entity: 'article',
          entityId: a.id,
          action: 'releaseScheduled',
          userId: null,
          diff: { scheduledAt: a.scheduledAt?.toISOString() ?? null },
        });
      }
    }
    return liberadas;
  }
}
