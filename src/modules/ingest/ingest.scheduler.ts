import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IngestService } from './ingest.service';

/**
 * Cron dentro del mismo proceso: suficiente a esta escala. Si algún día hay
 * varias instancias del backend o corridas pesadas, el paso siguiente es una
 * queue (BullMQ) con un worker dedicado.
 */
@Injectable()
export class IngestScheduler {
  private readonly logger = new Logger(IngestScheduler.name);

  constructor(private readonly ingest: IngestService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron() {
    this.logger.log('Ingesta programada: arrancando');
    try {
      await this.ingest.run();
    } catch (error) {
      // El lock lanza Conflict si ya hay una corrida en curso: no es un error grave
      this.logger.warn(`Ingesta programada omitida: ${String(error)}`);
    }
  }
}
