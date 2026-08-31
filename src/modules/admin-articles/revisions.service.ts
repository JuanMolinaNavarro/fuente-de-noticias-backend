import { Injectable, NotFoundException } from '@nestjs/common';
import { Article, RevisionReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Los campos que forman una "versión" del artículo. */
export const SNAPSHOT_FIELDS = [
  'kicker',
  'title',
  'summary',
  'contentJson',
  'content',
  'categoryId',
  'imageUrl',
  'featuredMediaId',
  'seoTitle',
  'seoDescription',
  'socialTitle',
  'isBreaking',
  'breakingUntil',
] as const;

export type ArticleSnapshot = Pick<Article, (typeof SNAPSHOT_FIELDS)[number]>;

/** Máximo de revisiones por nota; al superarlo se podan las AUTOSAVE viejas. */
const MAX_REVISIONS = 100;
/** Dos guardados del mismo usuario dentro de esta ventana no generan dos
 *  versiones: el autosave dispara cada pocos segundos y llenaría la tabla. */
const AUTOSAVE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Historial de versiones (estilo "revision history" de Arc XP).
 * Se guarda un snapshot JSON completo, no un diff: es más simple de restaurar
 * y agregar un campo a Article no obliga a migrar el historial.
 */
@Injectable()
export class RevisionsService {
  constructor(private readonly prisma: PrismaService) {}

  snapshotOf(article: Article): ArticleSnapshot {
    const out = {} as Record<string, unknown>;
    for (const f of SNAPSHOT_FIELDS) out[f] = article[f];
    return out as ArticleSnapshot;
  }

  /** Crea una revisión con el estado ACTUAL del artículo. */
  async create(
    article: Article,
    reason: RevisionReason,
    userId: string | null,
    note?: string | null,
  ) {
    const last = await this.prisma.articleRevision.findFirst({
      where: { articleId: article.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const revision = await this.prisma.articleRevision.create({
      data: {
        articleId: article.id,
        version: (last?.version ?? 0) + 1,
        snapshot: this.snapshotOf(article),
        reason,
        note: note ?? null,
        createdById: userId,
      },
    });
    await this.prune(article.id);
    return revision;
  }

  /**
   * Para el guardado normal (autosave): sólo crea una revisión si la última
   * del mismo usuario es más vieja que la ventana o tiene otro motivo.
   * Devuelve la revisión creada o null si se agrupó con la anterior.
   */
  async maybeAutosave(article: Article, userId: string) {
    const last = await this.prisma.articleRevision.findFirst({
      where: { articleId: article.id },
      orderBy: { version: 'desc' },
      select: { reason: true, createdById: true, createdAt: true },
    });
    const recent =
      last &&
      last.reason === 'AUTOSAVE' &&
      last.createdById === userId &&
      Date.now() - last.createdAt.getTime() < AUTOSAVE_WINDOW_MS;
    if (recent) return null;
    return this.create(article, 'AUTOSAVE', userId);
  }

  async list(articleId: string, page: number, limit: number) {
    const where = { articleId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.articleRevision.findMany({
        where,
        orderBy: { version: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        // el snapshot no viaja en el listado (puede pesar); se pide por id
        select: {
          id: true,
          version: true,
          reason: true,
          note: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.articleRevision.count({ where }),
    ]);
    return { data, total };
  }

  async get(articleId: string, revisionId: string) {
    const rev = await this.prisma.articleRevision.findFirst({
      where: { id: revisionId, articleId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!rev) throw new NotFoundException('Revisión no encontrada');
    return rev;
  }

  /** Borra las AUTOSAVE más viejas cuando se supera el tope. Las revisiones
   *  "importantes" (publish, correction, restore...) no se podan. */
  private async prune(articleId: string) {
    const total = await this.prisma.articleRevision.count({
      where: { articleId },
    });
    if (total <= MAX_REVISIONS) return;
    const excess = total - MAX_REVISIONS;
    const victims = await this.prisma.articleRevision.findMany({
      where: { articleId, reason: 'AUTOSAVE' },
      orderBy: { version: 'asc' },
      take: excess,
      select: { id: true },
    });
    if (victims.length) {
      await this.prisma.articleRevision.deleteMany({
        where: { id: { in: victims.map((v) => v.id) } },
      });
    }
  }
}
