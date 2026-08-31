import { Prisma } from '@prisma/client';
import {
  relativizarContenido,
  relativizarMediaUrl,
} from '../../media/media-url';

/**
 * DTO ≠ entidad: estos tipos definen QUÉ sale por el wire público.
 * La entidad Article (y su ArticleSource) tiene campos internos —guid,
 * feedUrl, originalContent, status, reviewedById, sourceSimilarity...— que
 * jamás deben exponerse. El mapper explícito hace imposible filtrarlos por
 * accidente.
 */

/** Relaciones que necesita el mapper público. */
export const PUBLIC_INCLUDE = {
  source: { select: { sourceName: true, sourceUrl: true } },
  featuredMedia: {
    select: {
      url: true,
      thumbUrl: true,
      alt: true,
      caption: true,
      width: true,
      height: true,
      focalX: true,
      focalY: true,
    },
  },
  categoryRef: { select: { name: true, slug: true, color: true } },
  authors: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { order: 'asc' },
  },
  tags: { include: { tag: { select: { name: true, slug: true } } } },
} satisfies Prisma.ArticleInclude;

export type PublicArticleRow = Prisma.ArticleGetPayload<{
  include: typeof PUBLIC_INCLUDE;
}>;

export interface MediaPublicDto {
  url: string;
  thumbUrl: string | null;
  alt: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  focalX: number | null;
  focalY: number | null;
}

/** Proyección de listado — coincide con el NotaResumen que usa el frontend. */
export interface ArticlePublicDto {
  id: string;
  slug: string | null;
  kicker: string | null;
  title: string | null;
  summary: string | null;
  /** nombre de la sección (compat con el frontend que filtra por nombre) */
  category: string | null;
  categorySlug: string | null;
  categoryColor: string | null;
  /** null en notas originales (no hay medio de origen) */
  sourceName: string | null;
  /** URL de la imagen destacada (Media propia o, si no hay, la externa legada) */
  imageUrl: string | null;
  featuredMedia: MediaPublicDto | null;
  publishedAt: Date | null;
  origin: 'FEED' | 'ORIGINAL';
  isBreaking: boolean;
  authors: { id: string; name: string }[];
  tags: { name: string; slug: string }[];
}

/** Detalle de nota: agrega el cuerpo y la atribución a la fuente original. */
export interface ArticleDetailDto extends ArticlePublicDto {
  content: string | null;
  contentJson: unknown;
  sourceUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  socialTitle: string | null;
  firstPublishedAt: Date | null;
  updatedAt: Date;
}

export function toPublicDto(a: PublicArticleRow): ArticlePublicDto {
  return {
    id: a.id,
    slug: a.slug,
    kicker: a.kicker,
    title: a.title,
    summary: a.summary,
    category: a.categoryRef?.name ?? null,
    categorySlug: a.categoryRef?.slug ?? null,
    categoryColor: a.categoryRef?.color ?? null,
    sourceName: a.source?.sourceName ?? null,
    // La Media propia manda; imageUrl externa queda como excepción/legado.
    // relativizar: la media propia sale como /uploads/... para que el browser
    // la resuelva contra el dominio actual (ver media-url.ts).
    imageUrl: relativizarMediaUrl(a.featuredMedia?.url ?? a.imageUrl),
    featuredMedia: a.featuredMedia
      ? {
          ...a.featuredMedia,
          url: relativizarMediaUrl(a.featuredMedia.url),
          thumbUrl: relativizarMediaUrl(a.featuredMedia.thumbUrl),
        }
      : null,
    publishedAt: a.publishedAt,
    origin: a.origin,
    isBreaking:
      a.isBreaking &&
      (!a.breakingUntil || a.breakingUntil.getTime() > Date.now()),
    authors: a.authors.map((x) => ({ id: x.user.id, name: x.user.name })),
    tags: a.tags.map((t) => ({ name: t.tag.name, slug: t.tag.slug })),
  };
}

export function toDetailDto(a: PublicArticleRow): ArticleDetailDto {
  return {
    ...toPublicDto(a),
    content: a.content,
    // Las imágenes insertadas en el cuerpo también guardan src absoluto
    contentJson: relativizarContenido(a.contentJson),
    sourceUrl: a.source?.sourceUrl ?? null,
    seoTitle: a.seoTitle,
    seoDescription: a.seoDescription,
    socialTitle: a.socialTitle,
    firstPublishedAt: a.firstPublishedAt,
    updatedAt: a.updatedAt,
  };
}
