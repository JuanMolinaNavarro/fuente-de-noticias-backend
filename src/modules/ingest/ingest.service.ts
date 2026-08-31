import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { draftFromFeed } from '../../domain/article-state';
import { plainTextToDoc } from '../../domain/content';
import { containment } from '../../domain/similarity';
import { PrismaService } from '../../prisma/prisma.service';
import { FeedsService } from '../feeds/feeds.service';
import { mapearCategoria } from './categorizer';
import { FeedParserAdapter } from './feed-parser.adapter';
import type { ParsedFeed } from './feed-parser.adapter';
import { stripHtml } from './html';
import { ImageExtractor } from './image-extractor';

export interface IngestSummary {
  feeds: number;
  nuevos: number;
  borradores: number;
  fallidos: number;
}

const MAX_PER_FEED = 6; // límite por corrida para no traer feeds enteros de una

const MAX_SUMMARY = 220;

/** Borrador inicial a partir del material crudo del feed: título y cuerpo
 *  tal cual llegaron, con un resumen truncado. La redacción es del editor. */
export function materialDeFuente(source: {
  originalTitle: string;
  originalContent: string | null;
}): { title: string; summary: string; content: string } {
  const content = source.originalContent || source.originalTitle;
  const summary =
    content.length > MAX_SUMMARY
      ? `${content.slice(0, MAX_SUMMARY - 1).trimEnd()}…`
      : content;
  return { title: source.originalTitle, summary, content };
}

/**
 * El pipeline de ingesta como composición de piezas chicas:
 * FeedsService (tabla Feed) → FeedParserAdapter → ImageExtractor →
 * categorizer → dominio (draftFromFeed). Este service solo orquesta.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedsService: FeedsService,
    private readonly feedParser: FeedParserAdapter,
    private readonly images: ImageExtractor,
  ) {}

  async run(): Promise<IngestSummary> {
    // Lock simple en memoria: si el cron y el botón manual coinciden,
    // la segunda corrida se rechaza en vez de duplicar trabajo.
    if (this.running) {
      throw new ConflictException('Ya hay una ingesta en curso');
    }
    this.running = true;
    try {
      return await this.doRun();
    } finally {
      this.running = false;
    }
  }

  private async doRun(): Promise<IngestSummary> {
    const feeds = await this.feedsService.findEnabled();
    const summary: IngestSummary = {
      feeds: feeds.length,
      nuevos: 0,
      borradores: 0,
      fallidos: 0,
    };
    if (feeds.length === 0) {
      this.logger.warn('No hay feeds habilitados: nada que ingerir');
      return summary;
    }

    // nombre de categoría → id (el categorizer devuelve nombres). La
    // comparación va sin tildes ni mayúsculas: el categorizer dice
    // "Tucumán" pero la tabla guarda "Tucuman".
    const normalizar = (s: string) =>
      s
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase();
    const categorias = await this.prisma.category.findMany();
    const idPorNombre = new Map(
      categorias.map((c) => [normalizar(c.name), c.id]),
    );

    // ── Pasada 1: traer items nuevos como INGESTED ────────────────────
    for (const feed of feeds) {
      let parsed: ParsedFeed;
      try {
        parsed = await this.feedParser.parse(feed.url);
      } catch (error) {
        this.logger.warn(`No se pudo leer ${feed.url}: ${String(error)}`);
        continue;
      }
      if (parsed.items.length === 0) {
        // Un feed que responde bien pero sin items es una fuente muerta
        // (p. ej. La Nación vació su RSS): sin este warn sería invisible.
        this.logger.warn(`Feed vacío: ${feed.url}`);
        continue;
      }

      for (const item of parsed.items.slice(0, MAX_PER_FEED)) {
        const imagen = await this.images.extract(item);
        const categoria =
          feed.category?.name ?? mapearCategoria(item.categories) ?? null;
        const categoriaId = categoria
          ? (idPorNombre.get(normalizar(categoria)) ?? null)
          : null;

        // Dedup por guid: la fuente ya existe → sólo backfill de lo que falte
        const existing = await this.prisma.articleSource.findUnique({
          where: { guid: item.guid },
          include: { article: { select: { id: true, categoryId: true } } },
        });
        if (existing) {
          if (!existing.originalImageUrl && imagen) {
            await this.prisma.articleSource.update({
              where: { id: existing.id },
              data: { originalImageUrl: imagen },
            });
          }
          if (!existing.article.categoryId && categoriaId) {
            await this.prisma.article.update({
              where: { id: existing.article.id },
              data: { categoryId: categoriaId },
            });
          }
          continue;
        }

        // Purgada hace poco: no re-crear mientras siga en el feed
        const lapida = await this.prisma.ingestTombstone.findUnique({
          where: { guid: item.guid },
        });
        if (lapida) continue;

        await this.prisma.article.create({
          data: {
            origin: 'FEED',
            status: 'INGESTED',
            categoryId: categoriaId,
            // La imagen del feed NO se copia a imageUrl: tiene copyright.
            // Queda como referencia en source.originalImageUrl; el editor
            // elige una propia (Fase 3: biblioteca de medios).
            source: {
              create: {
                guid: item.guid,
                feedUrl: feed.url,
                sourceName: parsed.sourceName,
                sourceUrl: item.link,
                originalTitle: stripHtml(item.title),
                originalContent: stripHtml(item.contentHtml),
                originalImageUrl: imagen,
              },
            },
          },
        });
        summary.nuevos++;
      }
    }

    // ── Pasada 2: INGESTED → DRAFT con el material copiado ────────────
    const pendientes = await this.prisma.article.findMany({
      where: { status: 'INGESTED', source: { isNot: null } },
      include: { source: true },
      orderBy: { fetchedAt: 'desc' },
    });
    this.logger.log(`${pendientes.length} artículos para pasar a borrador`);

    for (const art of pendientes) {
      const source = art.source!;
      try {
        const nota = materialDeFuente(source);
        // La transición pasa por el dominio (antes se escribía el status a mano)
        const draft = draftFromFeed(art, {
          title: nota.title,
          summary: nota.summary,
          content: nota.content,
          contentJson: plainTextToDoc(nota.content),
        });

        await this.prisma.article.update({
          where: { id: art.id },
          data: {
            ...draft,
            contentJson: draft.contentJson as Prisma.InputJsonValue,
            sourceSimilarity: containment(nota.content, source.originalContent),
          },
        });
        summary.borradores++;
      } catch (error) {
        summary.fallidos++;
        this.logger.error(
          `Falló "${source.originalTitle.slice(0, 50)}": ${String(error)}`,
        );
      }
    }

    this.logger.log(
      `Ingesta: ${summary.nuevos} nuevos, ${summary.borradores} a borrador, ${summary.fallidos} fallidos`,
    );
    return summary;
  }
}
