/**
 * Máquina de estados editorial — lógica de dominio pura.
 *
 *              ┌──────────── unpublish ────────────┐
 *              ▼                                    │
 *  INGESTED ─▶ DRAFT ──submit──▶ IN_REVIEW ──publish──▶ PUBLISHED
 *     │          │ ▲                │  │                   ▲
 *     │          │ └───── return ───┘  │ publish(scheduledAt futuro)
 *     │          │                     ▼                   │
 *     │          │                 SCHEDULED ──release(cron)┘
 *     │          │                     │ unschedule → DRAFT
 *     │          │                     │
 *     └── spike ─┴──── spike ──────────┘
 *                     ▼
 *                  SPIKED ──restore──▶ DRAFT
 *
 * Este archivo no importa nada de Nest ni de Prisma a propósito: las reglas
 * del negocio se pueden leer y testear sin levantar la app ni la base.
 * Cada función recibe el estado actual y devuelve LOS CAMPOS A ACTUALIZAR,
 * o lanza un error de dominio que la capa de servicio traduce a HTTP
 * (InvalidTransition → 409, Incomplete → 422).
 *
 * Quién puede disparar cada transición según su rol NO se decide acá sino en
 * article-policy.ts: una cosa es si la transición es legal para la nota,
 * otra si el actor tiene permiso. Separarlas hace ambas más fáciles de testear.
 */
import { slugify } from './slug';

export type ArticleStatus =
  'INGESTED' | 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'SPIKED';

export type ArticleOrigin = 'FEED' | 'ORIGINAL';

/* ── Errores de dominio ─────────────────────────────────────────────── */

export class InvalidTransitionError extends Error {
  constructor(from: ArticleStatus, action: string) {
    super(`No se puede ${action} un artículo en estado ${from}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Faltan campos obligatorios para la acción (equivale a las "validation
 *  rules" bloqueantes de un CMS: la UI muestra la lista `missing`). */
export class IncompleteArticleError extends Error {
  constructor(
    public readonly missing: string[],
    action = 'publicar',
  ) {
    super(`Para ${action}, el artículo necesita: ${missing.join(', ')}`);
    this.name = 'IncompleteArticleError';
  }
}

/* ── Helpers ────────────────────────────────────────────────────────── */

const isBlank = (s: string | null | undefined) => !s || s.trim() === '';

/** slug = título + últimos 6 chars del id, para que dos títulos iguales no
 *  colisionen. Se genera UNA vez (al publicar por primera vez) y no cambia
 *  aunque cambie el título: las URLs publicadas son un compromiso con el lector. */
export function buildSlug(title: string, id: string): string {
  return `${slugify(title)}-${id.slice(-6)}`;
}

/* ── Creación ───────────────────────────────────────────────────────── */

export interface NewOriginalFields {
  title: string;
  kicker?: string | null;
  summary?: string | null;
  categoryId?: string | null;
}

/** Nota escrita desde cero por un redactor: nace en DRAFT, sin fuente.
 *  El cuerpo (contentJson/content) lo resuelve el service: no es regla de negocio. */
export function createOriginal(
  fields: NewOriginalFields,
  createdById: string,
  now: Date,
) {
  if (isBlank(fields.title)) {
    throw new IncompleteArticleError(['title'], 'crear la nota');
  }
  return {
    origin: 'ORIGINAL' as const,
    status: 'DRAFT' as const,
    title: fields.title.trim(),
    kicker: fields.kicker ?? null,
    summary: fields.summary ?? null,
    categoryId: fields.categoryId ?? null,
    createdById,
    lastEditedById: createdById,
    fetchedAt: now,
    createdAt: now,
  };
}

/** Borrador inicial de la ingesta con el material del feed: INGESTED -> DRAFT. */
export function draftFromFeed(
  article: { status: ArticleStatus },
  draft: {
    title: string;
    summary: string;
    content: string;
    contentJson?: unknown;
  },
) {
  if (article.status !== 'INGESTED') {
    throw new InvalidTransitionError(article.status, 'pasar a borrador');
  }
  return {
    status: 'DRAFT' as const,
    title: draft.title,
    summary: draft.summary,
    content: draft.content,
    contentJson: draft.contentJson ?? null,
  };
}

/* ── Flujo redactor ─────────────────────────────────────────────────── */

/** DRAFT -> IN_REVIEW. Exige título y cuerpo (no tiene sentido revisar vacío). */
export function submitArticle(
  article: {
    status: ArticleStatus;
    title: string | null;
    content: string | null;
  },
  actorId: string,
  now: Date,
) {
  if (article.status !== 'DRAFT') {
    throw new InvalidTransitionError(article.status, 'enviar a revisión');
  }
  const missing: string[] = [];
  if (isBlank(article.title)) missing.push('title');
  if (isBlank(article.content)) missing.push('content');
  if (missing.length)
    throw new IncompleteArticleError(missing, 'enviar a revisión');
  return {
    status: 'IN_REVIEW' as const,
    reviewNote: null,
    lastEditedById: actorId,
    updatedAt: now,
  };
}

/* ── Flujo editor ───────────────────────────────────────────────────── */

/** IN_REVIEW -> DRAFT con una nota para el redactor ("devolver"). */
export function returnArticle(
  article: { status: ArticleStatus },
  note: string,
  reviewedById: string,
  now: Date,
) {
  if (article.status !== 'IN_REVIEW') {
    throw new InvalidTransitionError(article.status, 'devolver');
  }
  if (isBlank(note)) {
    throw new IncompleteArticleError(['note'], 'devolver');
  }
  return {
    status: 'DRAFT' as const,
    reviewNote: note.trim(),
    reviewedAt: now,
    reviewedById,
  };
}

export interface PublishableArticle {
  id: string;
  status: ArticleStatus;
  origin: ArticleOrigin;
  slug: string | null;
  title: string | null;
  content: string | null;
  categoryId: string | null;
  sourceSimilarity: number | null;
  firstPublishedAt: Date | null;
}

export interface PublishOptions {
  /** Si es futuro, la nota queda SCHEDULED y la libera el cron. */
  scheduledAt?: Date | null;
}

/**
 * INGESTED | DRAFT | IN_REVIEW -> PUBLISHED (o SCHEDULED si scheduledAt es futuro).
 * Reglas bloqueantes: título, cuerpo, sección. La similaridad con la fuente
 * se mide y se muestra, pero no bloquea. El slug se genera sólo si nunca tuvo uno.
 */
export function publishArticle(
  article: PublishableArticle,
  reviewedById: string,
  now: Date,
  opts: PublishOptions = {},
) {
  if (
    article.status !== 'DRAFT' &&
    article.status !== 'IN_REVIEW' &&
    article.status !== 'INGESTED'
  ) {
    throw new InvalidTransitionError(article.status, 'publicar');
  }
  const missing: string[] = [];
  if (isBlank(article.title)) missing.push('title');
  if (isBlank(article.content)) missing.push('content');
  if (!article.categoryId) missing.push('categoryId');
  if (missing.length) throw new IncompleteArticleError(missing);

  const slug = article.slug ?? buildSlug(article.title as string, article.id);
  const base = { slug, reviewedAt: now, reviewedById, reviewNote: null };

  if (opts.scheduledAt && opts.scheduledAt.getTime() > now.getTime()) {
    return {
      ...base,
      status: 'SCHEDULED' as const,
      scheduledAt: opts.scheduledAt,
      publishedAt: null,
    };
  }
  return {
    ...base,
    status: 'PUBLISHED' as const,
    scheduledAt: null,
    publishedAt: now,
    firstPublishedAt: article.firstPublishedAt ?? now,
  };
}

/** SCHEDULED -> PUBLISHED cuando llega la hora (lo dispara el cron). */
export function releaseScheduled(
  article: {
    status: ArticleStatus;
    scheduledAt: Date | null;
    firstPublishedAt: Date | null;
  },
  now: Date,
) {
  if (article.status !== 'SCHEDULED') {
    throw new InvalidTransitionError(article.status, 'liberar');
  }
  if (!article.scheduledAt || article.scheduledAt.getTime() > now.getTime()) {
    throw new Error('Todavía no llegó la hora programada');
  }
  return {
    status: 'PUBLISHED' as const,
    // La fecha de publicación es la programada, no el instante del cron
    publishedAt: article.scheduledAt,
    firstPublishedAt: article.firstPublishedAt ?? article.scheduledAt,
    scheduledAt: null,
  };
}

/** SCHEDULED -> DRAFT (cancelar la programación). */
export function unscheduleArticle(
  article: { status: ArticleStatus },
  reviewedById: string,
  now: Date,
) {
  if (article.status !== 'SCHEDULED') {
    throw new InvalidTransitionError(article.status, 'desprogramar');
  }
  return {
    status: 'DRAFT' as const,
    scheduledAt: null,
    reviewedAt: now,
    reviewedById,
  };
}

/**
 * PUBLISHED -> DRAFT. Saca la fecha de publicación pero CONSERVA el slug:
 * como publish ya no lo regenera, al republicar la URL es la misma sin riesgo
 * de colisión (que era el motivo por el que antes se liberaba).
 */
export function unpublishArticle(
  article: { status: ArticleStatus },
  reviewedById: string,
  now: Date,
) {
  if (article.status !== 'PUBLISHED') {
    throw new InvalidTransitionError(article.status, 'despublicar');
  }
  return {
    status: 'DRAFT' as const,
    publishedAt: null,
    reviewedAt: now,
    reviewedById,
  };
}

/** INGESTED | DRAFT | IN_REVIEW -> SPIKED (papelera blanda). Una nota
 *  publicada se despublica primero: descartar algo visible es dos decisiones. */
export function spikeArticle(
  article: { status: ArticleStatus },
  reviewedById: string,
  now: Date,
) {
  if (
    article.status !== 'INGESTED' &&
    article.status !== 'DRAFT' &&
    article.status !== 'IN_REVIEW'
  ) {
    throw new InvalidTransitionError(article.status, 'descartar');
  }
  return {
    status: 'SPIKED' as const,
    reviewedAt: now,
    reviewedById,
  };
}

/** SPIKED -> DRAFT. */
export function restoreArticle(
  article: { status: ArticleStatus },
  reviewedById: string,
  now: Date,
) {
  if (article.status !== 'SPIKED') {
    throw new InvalidTransitionError(article.status, 'restaurar');
  }
  return {
    status: 'DRAFT' as const,
    reviewedAt: now,
    reviewedById,
  };
}
