import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { Article, ArticleStatus, Prisma, RevisionReason } from '@prisma/client';
import { ZodError } from 'zod';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { paginate } from '../../common/dto/pagination.dto';
import type { Env } from '../../config/env.validation';
import {
  ArticleAction,
  assertCan,
  ForbiddenError,
} from '../../domain/article-policy';
import {
  createOriginal,
  IncompleteArticleError,
  InvalidTransitionError,
  publishArticle,
  restoreArticle,
  returnArticle,
  spikeArticle,
  submitArticle,
  unpublishArticle,
  unscheduleArticle,
} from '../../domain/article-state';
import { docToPlainText, parseDoc, plainTextToDoc } from '../../domain/content';
import { containment } from '../../domain/similarity';
import { slugify } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { JWT_AUD_PREVIEW } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { RevisionsService } from './revisions.service';

/* ── Shapes de lectura ─────────────────────────────────────────────── */

/** Detalle completo: lo que ve el editor al abrir una nota. */
export const DETAIL_INCLUDE = {
  source: true,
  categoryRef: true,
  featuredMedia: true,
  tags: { include: { tag: true } },
  // Sin email: el detalle lo ve cualquier rol autenticado y el correo de los
  // autores no se usa en el panel (los emails viven en /admin/users, ADMIN).
  authors: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { order: 'asc' },
  },
  createdBy: { select: { id: true, name: true } },
  lastEditedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  _count: { select: { revisions: true } },
} satisfies Prisma.ArticleInclude;

export type ArticleDetail = Prisma.ArticleGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

/** Fila de la bandeja: sin cuerpo ni material original (pesan y no se listan). */
export const LIST_SELECT = {
  id: true,
  origin: true,
  status: true,
  kicker: true,
  title: true,
  summary: true,
  slug: true,
  imageUrl: true,
  featuredMedia: { select: { id: true, url: true, thumbUrl: true, alt: true } },
  categoryId: true,
  categoryRef: { select: { id: true, name: true, slug: true, color: true } },
  isBreaking: true,
  breakingUntil: true,
  scheduledAt: true,
  publishedAt: true,
  fetchedAt: true,
  createdAt: true,
  updatedAt: true,
  sourceSimilarity: true,
  reviewNote: true,
  createdBy: { select: { id: true, name: true } },
  lastEditedBy: { select: { id: true, name: true } },
  source: {
    select: { sourceName: true, sourceUrl: true, originalImageUrl: true },
  },
} satisfies Prisma.ArticleSelect;

export type ArticleListItem = Prisma.ArticleGetPayload<{
  select: typeof LIST_SELECT;
}>;

const STATS_KEYS: Record<ArticleStatus, string> = {
  INGESTED: 'ingested',
  DRAFT: 'draft',
  IN_REVIEW: 'inReview',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  SPIKED: 'spiked',
};

/** Cupo de Última hora (el ticker del home muestra 3: home.service). Al
 *  marcar una nueva urgente, las más viejas salen solas (FIFO). */
const MAX_BREAKING = 3;

/** Campos donde "" significa "sin valor" y se guarda null. */
const NULLABLE_STRINGS = [
  'kicker',
  'title',
  'summary',
  'categoryId',
  'imageUrl',
  'featuredMediaId',
  'seoTitle',
  'seoDescription',
  'socialTitle',
] as const;

@Injectable()
export class AdminArticlesService {
  private readonly previewTtl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly revisions: RevisionsService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.previewTtl = config.get('PREVIEW_TOKEN_TTL', { infer: true });
  }

  /* ── Lectura ─────────────────────────────────────────────────────── */

  /** Un solo groupBy en vez de 6 counts: la DB agrupa mejor que 6 round-trips. */
  async stats() {
    const groups = await this.prisma.article.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const stats: Record<string, number> = {};
    for (const key of Object.values(STATS_KEYS)) stats[key] = 0;
    for (const g of groups) stats[STATS_KEYS[g.status]] = g._count._all;
    return stats;
  }

  async list(q: AdminListQueryDto, limit: number) {
    const where: Prisma.ArticleWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.origin && { origin: q.origin }),
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...(q.authorId && { createdById: q.authorId }),
      ...((q.from || q.to) && {
        updatedAt: {
          ...(q.from && { gte: new Date(q.from) }),
          ...(q.to && { lte: new Date(q.to) }),
        },
      }),
      ...(q.q && {
        OR: [
          { title: { contains: q.q, mode: 'insensitive' } },
          { kicker: { contains: q.q, mode: 'insensitive' } },
          { summary: { contains: q.q, mode: 'insensitive' } },
          {
            source: {
              originalTitle: { contains: q.q, mode: 'insensitive' },
            },
          },
        ],
      }),
    };

    // Orden por defecto: publicadas por fecha de publicación; el resto por
    // última modificación (lo que la redacción está tocando, arriba).
    const sort =
      q.sort ?? (q.status === 'PUBLISHED' ? 'publishedAt' : 'updatedAt');
    const order = q.order ?? 'desc';

    const [data, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { [sort]: order },
        skip: (q.page - 1) * limit,
        take: limit,
      }),
      this.prisma.article.count({ where }),
    ]);
    return paginate(data, total, q.page, limit);
  }

  async getById(id: string): Promise<ArticleDetail> {
    const article = await this.prisma.article.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!article) throw new NotFoundException('Artículo no encontrado');
    return article;
  }

  /* ── Creación y edición ──────────────────────────────────────────── */

  async create(dto: CreateArticleDto, actor: AuthUser): Promise<ArticleDetail> {
    this.runDomain(() => assertCan('create', actor));
    const now = new Date();
    const base = this.runDomain(() =>
      createOriginal(
        {
          title: dto.title,
          kicker: dto.kicker || null,
          summary: dto.summary || null,
          categoryId: dto.categoryId || null,
        },
        actor.id,
        now,
      ),
    );
    const body = this.resolveBody(dto);
    const tags = await this.resolveTags(dto.tagNames);

    const article = await this.prisma.article.create({
      data: {
        ...base,
        ...body,
        ...(tags && { tags: { create: tags } }),
      },
      include: DETAIL_INCLUDE,
    });
    await this.revisions.create(article, 'MANUAL', actor.id, 'Creación');
    await this.audit.log({
      entity: 'article',
      entityId: article.id,
      action: 'create',
      userId: actor.id,
      diff: { title: article.title },
    });
    // Se relee para que _count.revisions ya incluya la revisión "Creación"
    return this.getById(article.id);
  }

  /** El "guardar" del panel: persiste ediciones sin cambiar el estado. */
  async update(
    id: string,
    dto: UpdateArticleDto,
    actor: AuthUser,
  ): Promise<ArticleDetail> {
    const article = await this.getById(id);
    this.runDomain(() => assertCan('edit', actor, article));

    if (
      dto.expectedUpdatedAt &&
      new Date(dto.expectedUpdatedAt).getTime() !== article.updatedAt.getTime()
    ) {
      throw new ConflictException(
        'Otra persona guardó esta nota mientras la editabas. Recargá para ver los cambios.',
      );
    }

    this.assertBreakingCoherente(dto, article);
    const data = await this.buildUpdateData(dto, article);
    data.lastEditedById = actor.id;

    const updated = await this.prisma.article.update({
      where: { id },
      data,
      include: DETAIL_INCLUDE,
    });

    // FIFO de Última hora: si esta nota acaba de entrar al cupo, la más vieja sale sola
    if (dto.isBreaking === true && !article.isBreaking) {
      await this.rotateBreaking();
    }

    // Sobre una nota publicada, cada guardado es una corrección visible al
    // lector: siempre queda una versión (y la nota explicando por qué).
    if (article.status === 'PUBLISHED') {
      await this.revisions.create(updated, 'CORRECTION', actor.id, dto.note);
    } else {
      await this.revisions.maybeAutosave(updated, actor.id);
    }
    await this.audit.log({
      entity: 'article',
      entityId: id,
      action: article.status === 'PUBLISHED' ? 'correct' : 'update',
      userId: actor.id,
      diff: { fields: Object.keys(data) },
    });
    return updated;
  }

  /* ── Transiciones ────────────────────────────────────────────────── */

  submit(id: string, actor: AuthUser) {
    return this.transition(
      id,
      actor,
      'submit',
      (a, now) => submitArticle(a, actor.id, now),
      { revision: 'SUBMIT' },
    );
  }

  return(id: string, note: string, actor: AuthUser) {
    return this.transition(
      id,
      actor,
      'return',
      (a, now) => returnArticle(a, note, actor.id, now),
      { auditDiff: { note } },
    );
  }

  publish(id: string, scheduledAt: string | undefined, actor: AuthUser) {
    return this.transition(
      id,
      actor,
      'publish',
      (a, now) =>
        publishArticle(a, actor.id, now, {
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        }),
      { revision: 'PUBLISH' },
    );
  }

  unschedule(id: string, actor: AuthUser) {
    return this.transition(id, actor, 'unschedule', (a, now) =>
      unscheduleArticle(a, actor.id, now),
    );
  }

  unpublish(id: string, actor: AuthUser) {
    return this.transition(
      id,
      actor,
      'unpublish',
      (a, now) => unpublishArticle(a, actor.id, now),
      { revision: 'UNPUBLISH' },
    );
  }

  spike(id: string, actor: AuthUser) {
    return this.transition(id, actor, 'spike', (a, now) =>
      spikeArticle(a, actor.id, now),
    );
  }

  restore(id: string, actor: AuthUser) {
    return this.transition(id, actor, 'restore', (a, now) =>
      restoreArticle(a, actor.id, now),
    );
  }

  /* ── Revisiones ──────────────────────────────────────────────────── */

  // El historial es legible por cualquier rol: decisión EXPLÍCITA (view=true
  // para todos en article-policy), no un permiso olvidado. Si algún día el
  // historial debe restringirse, se cambia la política, no estos métodos.
  async listRevisions(id: string, page: number, limit: number, actor: AuthUser) {
    const article = await this.getById(id);
    this.runDomain(() => assertCan('view', actor, article));
    const { data, total } = await this.revisions.list(id, page, limit);
    return paginate(data, total, page, limit);
  }

  async getRevision(id: string, revisionId: string, actor: AuthUser) {
    const article = await this.getById(id);
    this.runDomain(() => assertCan('view', actor, article));
    return this.revisions.get(id, revisionId);
  }

  async restoreRevision(id: string, revisionId: string, actor: AuthUser) {
    const article = await this.getById(id);
    this.runDomain(() => assertCan('restoreRevision', actor, article));
    const rev = await this.revisions.get(id, revisionId);
    const snap = rev.snapshot as Prisma.JsonObject;

    // La urgencia es estado del presente, no del contenido: un snapshot con
    // vencimiento pasado (o sin vencimiento, de antes de que fuera obligatorio)
    // se restaura como no-urgente, sin error.
    const snapUntil = snap.breakingUntil
      ? new Date(snap.breakingUntil as string)
      : null;
    const urgenteValida =
      Boolean(snap.isBreaking) &&
      snapUntil !== null &&
      snapUntil.getTime() > Date.now();

    const data: Prisma.ArticleUncheckedUpdateInput = {
      kicker: (snap.kicker as string | null) ?? null,
      title: (snap.title as string | null) ?? null,
      summary: (snap.summary as string | null) ?? null,
      contentJson:
        (snap.contentJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      content: (snap.content as string | null) ?? null,
      categoryId: (snap.categoryId as string | null) ?? null,
      imageUrl: (snap.imageUrl as string | null) ?? null,
      featuredMediaId: (snap.featuredMediaId as string | null) ?? null,
      seoTitle: (snap.seoTitle as string | null) ?? null,
      seoDescription: (snap.seoDescription as string | null) ?? null,
      socialTitle: (snap.socialTitle as string | null) ?? null,
      isBreaking: urgenteValida,
      breakingUntil: urgenteValida ? snapUntil : null,
      breakingSince:
        urgenteValida && !article.isBreaking
          ? new Date()
          : urgenteValida
            ? undefined // ya estaba: conserva su sello de entrada
            : null,
      lastEditedById: actor.id,
    };
    if (article.origin === 'FEED' && article.source) {
      data.sourceSimilarity = containment(
        (data.content as string | null) ?? '',
        article.source.originalContent,
      );
    }
    const updated = await this.prisma.article.update({
      where: { id },
      data,
      include: DETAIL_INCLUDE,
    });
    // La versión restaurada puede reactivar Última hora: el cupo FIFO aplica igual
    if (urgenteValida && !article.isBreaking) {
      await this.rotateBreaking();
    }
    await this.revisions.create(
      updated,
      'RESTORE',
      actor.id,
      `Restaurada la versión ${rev.version}`,
    );
    await this.audit.log({
      entity: 'article',
      entityId: id,
      action: 'restoreRevision',
      userId: actor.id,
      diff: { version: rev.version },
    });
    return updated;
  }

  /* ── Vista previa ────────────────────────────────────────────────── */

  /**
   * Token efímero para ver una nota no publicada. Es un JWT (y no una tabla)
   * porque es sin estado, expira solo y ya tenemos JwtService: menos partes.
   */
  async previewToken(id: string, actor: AuthUser) {
    const article = await this.getById(id);
    // 'preview' (no 'view'): el enlace resultante es público, así que un
    // REDACTOR sólo puede emitirlo para sus propias notas (article-policy).
    this.runDomain(() => assertCan('preview', actor, article));
    const token = await this.jwt.signAsync(
      { sub: id, kind: 'preview' },
      {
        expiresIn: this.previewTtl as JwtSignOptions['expiresIn'],
        // Audience propia: este token no sirve como sesión (JwtStrategy exige
        // "session") y una sesión no sirve como vista previa (findForPreview
        // exige "preview"), aunque compartan JWT_SECRET.
        audience: JWT_AUD_PREVIEW,
      },
    );
    return { token, expiresIn: this.previewTtl };
  }

  /* ── Internos ────────────────────────────────────────────────────── */

  private async transition(
    id: string,
    actor: AuthUser,
    action: ArticleAction,
    fn: (
      article: ArticleDetail,
      now: Date,
    ) => Prisma.ArticleUncheckedUpdateInput,
    opts: {
      revision?: RevisionReason;
      auditDiff?: Prisma.InputJsonValue;
    } = {},
  ): Promise<ArticleDetail> {
    const article = await this.getById(id);
    const now = new Date();
    const data = this.runDomain(() => {
      assertCan(action, actor, article);
      return fn(article, now);
    });
    const updated = await this.prisma.article.update({
      where: { id },
      data,
      include: DETAIL_INCLUDE,
    });
    if (opts.revision) {
      await this.revisions.create(updated, opts.revision, actor.id);
    }
    await this.audit.log({
      entity: 'article',
      entityId: id,
      action,
      userId: actor.id,
      diff: opts.auditDiff ?? { from: article.status, to: updated.status },
    });
    return updated;
  }

  /** contentJson manda; si sólo viene texto plano, se genera el documento. */
  private resolveBody(dto: {
    contentJson?: Record<string, unknown>;
    content?: string;
  }): {
    contentJson?: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
    content?: string | null;
  } {
    if (dto.contentJson !== undefined) {
      const doc = this.runDomain(() => parseDoc(dto.contentJson));
      const text = docToPlainText(doc);
      return {
        contentJson: doc,
        content: text || null,
      };
    }
    if (dto.content !== undefined) {
      if (!dto.content) return { content: null, contentJson: Prisma.JsonNull };
      // Ida y vuelta por el doc: normaliza saltos de línea (CRLF) y espacios
      const doc = plainTextToDoc(dto.content);
      return { content: docToPlainText(doc) || null, contentJson: doc };
    }
    return {};
  }

  /**
   * Toda urgente necesita vencimiento futuro. Se valida sólo cuando el PATCH
   * toca isBreaking/breakingUntil, y sobre el estado RESULTANTE (dto si vino,
   * valor actual si no): así una nota vieja incoherente (urgente sin fecha)
   * se puede seguir editando en sus otros campos sin romperse.
   */
  private assertBreakingCoherente(
    dto: UpdateArticleDto,
    article: ArticleDetail,
  ) {
    if (dto.isBreaking === undefined && dto.breakingUntil === undefined) return;
    const isBreaking = dto.isBreaking ?? article.isBreaking;
    if (!isBreaking) return;
    const until =
      dto.breakingUntil !== undefined
        ? dto.breakingUntil
          ? new Date(dto.breakingUntil)
          : null
        : article.breakingUntil;
    if (!until || until.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Una nota urgente necesita fecha de vencimiento futura (campo "Hasta").',
      );
    }
  }

  private async buildUpdateData(
    dto: UpdateArticleDto,
    article: ArticleDetail,
  ): Promise<Prisma.ArticleUncheckedUpdateInput> {
    const data: Prisma.ArticleUncheckedUpdateInput = {};

    for (const f of NULLABLE_STRINGS) {
      if (dto[f] !== undefined) data[f] = dto[f] || null;
    }
    if (dto.isBreaking !== undefined) {
      data.isBreaking = dto.isBreaking;
      // Sello de entrada a Última hora: base del FIFO del cupo (rotateBreaking)
      if (dto.isBreaking && !article.isBreaking) data.breakingSince = new Date();
      // Desmarcar limpia todo: sin flag no queda ni sello ni vencimiento
      if (!dto.isBreaking) {
        data.breakingSince = null;
        data.breakingUntil = null;
      }
    }
    if (dto.breakingUntil !== undefined) {
      data.breakingUntil = dto.breakingUntil
        ? new Date(dto.breakingUntil)
        : null;
    }

    Object.assign(data, this.resolveBody(dto));

    // La similaridad se recalcula sólo si cambió el cuerpo (O(n), sin IA).
    if (
      data.content !== undefined &&
      article.origin === 'FEED' &&
      article.source
    ) {
      data.sourceSimilarity = containment(
        (data.content as string | null) ?? '',
        article.source.originalContent,
      );
    }

    const tags = await this.resolveTags(dto.tagNames);
    if (tags) data.tags = { deleteMany: {}, create: tags };

    if (dto.authorIds !== undefined) {
      data.authors = {
        deleteMany: {},
        create: dto.authorIds.map((userId, order) => ({ userId, order })),
      };
    }
    return data;
  }

  /**
   * FIFO de Última hora: si las urgentes activas superan el cupo, las más
   * viejas (por breakingSince; sin sello = las más viejas de todas) dejan de
   * ser urgentes. Se llama después de que una nota ENTRA al cupo.
   */
  private async rotateBreaking() {
    const now = new Date();
    const activas = await this.prisma.article.findMany({
      where: {
        isBreaking: true,
        OR: [{ breakingUntil: null }, { breakingUntil: { gt: now } }],
      },
      orderBy: { breakingSince: { sort: 'asc', nulls: 'first' } },
      select: { id: true, title: true },
    });
    const sobran = activas.length - MAX_BREAKING;
    if (sobran <= 0) return;
    const salen = activas.slice(0, sobran);
    await this.prisma.article.updateMany({
      where: { id: { in: salen.map((a) => a.id) } },
      data: { isBreaking: false, breakingUntil: null, breakingSince: null },
    });
    for (const a of salen) {
      await this.audit.log({
        entity: 'article',
        entityId: a.id,
        action: 'breakingRotated',
        userId: null,
        diff: { title: a.title, maxBreaking: MAX_BREAKING },
      });
    }
  }

  /** Nombres de tag -> filas Tag (crea las que no existen) -> ArticleTag. */
  private async resolveTags(names: string[] | undefined) {
    if (names === undefined) return undefined;
    const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const rows = await Promise.all(
      clean.map((name) =>
        this.prisma.tag.upsert({
          where: { slug: slugify(name) },
          update: {},
          create: { name, slug: slugify(name) },
        }),
      ),
    );
    return rows.map((t) => ({ tagId: t.id }));
  }

  /** Traduce errores de dominio (puros) a errores HTTP (infraestructura). */
  private runDomain<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof IncompleteArticleError) {
        throw new UnprocessableEntityException({
          message: error.message,
          missing: error.missing,
        });
      }
      if (error instanceof InvalidTransitionError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof ForbiddenError) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'El cuerpo de la nota tiene un formato inválido',
          issues: error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      throw error;
    }
  }
}

export type { Article };
