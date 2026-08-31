import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MarketIndicator, MarketSnapshot } from '@prisma/client';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { ALL_INDICATORS, INDICATORS, IndicatorMeta } from './market-indicators';
import {
  computeVariation,
  referenceCutoff,
  Variation,
} from './market-variation';
import { MARKET_SOURCES } from './market.port';
import type { MarketSourcePort, Quote } from './market.port';

/** Debe coincidir con el cron de `market.scheduler.ts`. */
export const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
/** Cuánta historia guardamos. 9 indicadores × 96 capturas/día ≈ 78 k filas en 90 días. */
const RETENTION_DAYS = 90;
/** El resumen se pide en cada render de la home; no vale la pena ir a la DB cada vez. */
const SUMMARY_CACHE_TTL_MS = 60 * 1000;

export interface IndicatorSummary extends IndicatorMeta {
  value: number;
  buy: number | null;
  sell: number | null;
  sourceAt: Date | null;
  capturedAt: Date;
  /** null mientras no haya una captura de hace ≥ 24 h con qué comparar. */
  variation: Variation | null;
  /** Capturas de las últimas 24 h, para el mini-gráfico. */
  history: { t: Date; v: number }[];
}

export interface MarketSummary {
  /** Última captura exitosa (la más nueva entre todos los indicadores). */
  updatedAt: Date | null;
  indicators: IndicatorSummary[];
}

export interface RefreshReport {
  capturedAt: Date;
  saved: number;
  failed: string[];
}

@Injectable()
export class MarketService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MarketService.name);
  private running = false;
  private summaryCache: { data: MarketSummary; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(MARKET_SOURCES) private readonly sources: MarketSourcePort[],
  ) {}

  /**
   * Al arrancar, si el último snapshot es viejo (o no hay ninguno), disparamos
   * una captura en segundo plano así la home no queda vacía hasta el próximo
   * cron. No se espera: un proveedor lento no debe demorar el arranque.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    const latest = await this.prisma.marketSnapshot.findFirst({
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    });
    const fresh =
      latest && Date.now() - latest.capturedAt.getTime() < REFRESH_INTERVAL_MS;
    if (fresh) return;
    void this.refresh().catch((error) =>
      this.logger.warn(`Captura inicial de mercado falló: ${String(error)}`),
    );
  }

  /**
   * Consulta TODAS las fuentes y guarda un snapshot por indicador. Si una
   * fuente falla, las demás se guardan igual (allSettled): un Yahoo caído no
   * tiene por qué dejarnos sin dólares.
   */
  async refresh(): Promise<RefreshReport> {
    if (this.running) {
      throw new ConflictException(
        'Ya hay una actualización de mercado en curso',
      );
    }
    this.running = true;
    try {
      const capturedAt = new Date();
      const results = await Promise.allSettled(
        this.sources.map((s) => s.fetchQuotes()),
      );

      const rows: Array<
        Pick<
          MarketSnapshot,
          'indicator' | 'value' | 'buy' | 'sell' | 'source' | 'sourceAt'
        > & { capturedAt: Date }
      > = [];
      const failed: string[] = [];

      results.forEach((result, i) => {
        const source = this.sources[i];
        if (result.status === 'rejected') {
          failed.push(source.name);
          this.logger.warn(
            `Fuente ${source.name} falló: ${String(result.reason)}`,
          );
          return;
        }
        for (const q of result.value)
          rows.push(toRow(q, source.name, capturedAt));
      });

      if (rows.length > 0) {
        await this.prisma.marketSnapshot.createMany({ data: rows });
        this.summaryCache = null; // hay datos nuevos: invalidar
      }
      await this.pruneOld(capturedAt);

      this.logger.log(
        `Mercado: ${rows.length} cotizaciones guardadas` +
          (failed.length ? `, fallaron: ${failed.join(', ')}` : ''),
      );
      return { capturedAt, saved: rows.length, failed };
    } finally {
      this.running = false;
    }
  }

  /**
   * Resumen para la home: último valor de cada indicador + variación contra
   * la captura de hace 24 h + historia de 24 h. Solo lee de la DB: la frescura
   * la garantiza el cron, no el request.
   */
  async getSummary(): Promise<MarketSummary> {
    const nowMs = Date.now();
    if (
      this.summaryCache &&
      nowMs - this.summaryCache.at < SUMMARY_CACHE_TTL_MS
    ) {
      return this.summaryCache.data;
    }

    const now = new Date(nowMs);
    const cutoff = referenceCutoff(now);

    // Tres lecturas en paralelo, todas apoyadas en el índice (indicator, capturedAt):
    //  1. el último snapshot de cada indicador,
    //  2. el snapshot "de hace 24 h" de cada indicador (el más reciente ≤ cutoff),
    //  3. todo lo capturado en las últimas 24 h (historia para el gráfico).
    const [latest, references, recent] = await Promise.all([
      this.latestPerIndicator(),
      this.referencePerIndicator(cutoff),
      this.prisma.marketSnapshot.findMany({
        where: { capturedAt: { gte: cutoff } },
        orderBy: { capturedAt: 'asc' },
        select: { indicator: true, value: true, capturedAt: true },
      }),
    ]);

    const historyByIndicator = new Map<
      MarketIndicator,
      { t: Date; v: number }[]
    >();
    for (const r of recent) {
      const list = historyByIndicator.get(r.indicator) ?? [];
      list.push({ t: r.capturedAt, v: r.value });
      historyByIndicator.set(r.indicator, list);
    }

    const indicators: IndicatorSummary[] = [];
    for (const meta of INDICATORS) {
      const current = latest.get(meta.id);
      if (!current) continue; // todavía no capturamos este indicador
      const reference = references.get(meta.id) ?? null;
      indicators.push({
        ...meta,
        value: current.value,
        buy: current.buy,
        sell: current.sell,
        sourceAt: current.sourceAt,
        capturedAt: current.capturedAt,
        variation: computeVariation(current, reference),
        history: historyByIndicator.get(meta.id) ?? [],
      });
    }

    const updatedAt = indicators.reduce<Date | null>(
      (max, i) => (!max || i.capturedAt > max ? i.capturedAt : max),
      null,
    );

    const data: MarketSummary = { updatedAt, indicators };
    this.summaryCache = { data, at: nowMs };
    return data;
  }

  private async latestPerIndicator(): Promise<
    Map<MarketIndicator, MarketSnapshot>
  > {
    const rows = await Promise.all(
      ALL_INDICATORS.map((indicator) =>
        this.prisma.marketSnapshot.findFirst({
          where: { indicator },
          orderBy: { capturedAt: 'desc' },
        }),
      ),
    );
    return toMap(rows);
  }

  private async referencePerIndicator(
    cutoff: Date,
  ): Promise<Map<MarketIndicator, MarketSnapshot>> {
    const rows = await Promise.all(
      ALL_INDICATORS.map((indicator) =>
        this.prisma.marketSnapshot.findFirst({
          where: { indicator, capturedAt: { lte: cutoff } },
          orderBy: { capturedAt: 'desc' },
        }),
      ),
    );
    return toMap(rows);
  }

  private async pruneOld(now: Date): Promise<void> {
    const limit = new Date(
      now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const { count } = await this.prisma.marketSnapshot.deleteMany({
      where: { capturedAt: { lt: limit } },
    });
    if (count > 0)
      this.logger.log(`Mercado: ${count} snapshots viejos borrados`);
  }
}

function toRow(q: Quote, source: string, capturedAt: Date) {
  return {
    indicator: q.indicator,
    value: q.value,
    buy: q.buy ?? null,
    sell: q.sell ?? null,
    source,
    sourceAt: q.sourceAt ?? null,
    capturedAt,
  };
}

function toMap(rows: (MarketSnapshot | null)[]) {
  const map = new Map<MarketIndicator, MarketSnapshot>();
  for (const row of rows) if (row) map.set(row.indicator, row);
  return map;
}
