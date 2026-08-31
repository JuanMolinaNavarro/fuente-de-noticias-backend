import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Cuánto vive una lápida antes de purgarse a su vez: pasados estos días el
// item ya no debería aparecer en el feed, y si reaparece es noticia de nuevo.
const TOMBSTONE_RETENTION_DAYS = 60;

/**
 * Limpieza de la bandeja: cada hora purga los borradores de feed (INGESTED o
 * DRAFT) que nadie tocó en DRAFT_TTL_HOURS. Antes de borrarlos deja una
 * "lápida" (IngestTombstone) con el guid del item: la ingesta la consulta
 * para no re-crear la misma noticia mientras siga apareciendo en el feed.
 * Mismo molde que PublishScheduler (cron in-process).
 */
@Injectable()
export class CleanupScheduler {
  private readonly logger = new Logger(CleanupScheduler.name);
  private readonly ttlHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlHours = config.get('DRAFT_TTL_HOURS', { infer: true });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    try {
      const n = await this.purgeStale();
      if (n > 0) this.logger.log(`Purgados ${n} borradores de feed vencidos`);
    } catch (error) {
      this.logger.error(`Error purgando borradores: ${String(error)}`);
    }
  }

  /** Purga los borradores de feed vencidos. Devuelve cuántos borró. Pública para tests. */
  async purgeStale(now = new Date()): Promise<number> {
    const limite = new Date(now.getTime() - this.ttlHours * 3_600_000);

    // Sólo notas que vinieron del feed y nadie hizo avanzar en el flujo:
    // IN_REVIEW/SCHEDULED/PUBLISHED/SPIKED ya tienen trabajo humano encima.
    const vencidos = await this.prisma.article.findMany({
      where: {
        origin: 'FEED',
        status: { in: ['INGESTED', 'DRAFT'] },
        fetchedAt: { lt: limite },
      },
      select: {
        id: true,
        title: true,
        source: { select: { guid: true, feedUrl: true } },
      },
    });

    if (vencidos.length === 0) {
      await this.purgeOldTombstones(now);
      return 0;
    }

    const ids = vencidos.map((a) => a.id);
    const lapidas = vencidos
      .filter((a) => a.source)
      .map((a) => ({
        guid: a.source!.guid,
        feedUrl: a.source!.feedUrl,
        title: a.title,
      }));

    // Lápida y borrado en la misma transacción: si algo falla no queda ni
    // el artículo borrado sin lápida ni la lápida sin borrado.
    await this.prisma.$transaction([
      this.prisma.ingestTombstone.createMany({
        data: lapidas,
        skipDuplicates: true,
      }),
      this.prisma.article.deleteMany({ where: { id: { in: ids } } }),
    ]);

    await this.purgeOldTombstones(now);

    // Una entrada de auditoría por corrida (no una por nota: sería ruido)
    await this.audit.log({
      entity: 'article',
      entityId: 'purge',
      action: 'purgeStaleDrafts',
      userId: null,
      diff: { count: ids.length, ttlHours: this.ttlHours, ids: ids.slice(0, 50) },
    });

    return ids.length;
  }

  /** Borra las lápidas más viejas que la retención: el feed ya no trae ese item. */
  private async purgeOldTombstones(now: Date): Promise<void> {
    const limite = new Date(
      now.getTime() - TOMBSTONE_RETENTION_DAYS * 24 * 3_600_000,
    );
    await this.prisma.ingestTombstone.deleteMany({
      where: { deletedAt: { lt: limite } },
    });
  }
}
