import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { paginate, Paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { JWT_AUD_PREVIEW, JWT_ISSUER } from '../auth/auth.service';
import {
  ArticleDetailDto,
  ArticlePublicDto,
  PUBLIC_INCLUDE,
  toDetailDto,
  toPublicDto,
} from './dto/article-response.dto';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Solo artículos PUBLISHED: el sitio público jamás ve borradores. */
  async findPublished(params: {
    category?: string;
    page: number;
    limit: number;
  }): Promise<Paginated<ArticlePublicDto>> {
    const { category, page, limit } = params;
    const where: Prisma.ArticleWhereInput = {
      status: 'PUBLISHED',
      // El frontend manda el nombre ("Economía") o el slug ("economia"):
      // aceptamos ambos para no romper las URLs de sección existentes.
      ...(category && {
        categoryRef: { OR: [{ name: category }, { slug: category }] },
      }),
    };

    const [articles, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        include: PUBLIC_INCLUDE,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.article.count({ where }),
    ]);

    return paginate(articles.map(toPublicDto), total, page, limit);
  }

  /**
   * Proyección mínima para el sitemap: solo los campos que el XML necesita.
   * `select` (en vez de `include`) evita cargar cuerpo, medios y autores de
   * cada nota — con miles de artículos la diferencia es de órdenes de
   * magnitud. Cap en 1000: si el archivo histórico crece más, el paso
   * siguiente es un sitemap paginado (generateSitemaps en el frontend).
   */
  listSlugs(): Promise<
    { slug: string | null; publishedAt: Date | null; updatedAt: Date }[]
  > {
    return this.prisma.article.findMany({
      where: { status: 'PUBLISHED' },
      select: { slug: true, publishedAt: true, updatedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
    });
  }

  async findBySlug(slug: string): Promise<ArticleDetailDto> {
    const article = await this.prisma.article.findUnique({
      where: { slug },
      include: PUBLIC_INCLUDE,
    });
    // Un artículo no publicado "no existe" para el público: 404, no 403,
    // para no revelar que hay un borrador con ese slug.
    if (!article || article.status !== 'PUBLISHED') {
      throw new NotFoundException('Artículo no encontrado');
    }
    return toDetailDto(article);
  }

  async findRelated(slug: string, limit: number): Promise<ArticlePublicDto[]> {
    const article = await this.prisma.article.findUnique({ where: { slug } });
    if (!article || article.status !== 'PUBLISHED') {
      throw new NotFoundException('Artículo no encontrado');
    }
    if (!article.categoryId) return [];

    const related = await this.prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        categoryId: article.categoryId,
        id: { not: article.id },
      },
      include: PUBLIC_INCLUDE,
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
    return related.map(toPublicDto);
  }

  /**
   * Vista previa de una nota NO publicada con un token efímero emitido por el
   * panel (POST /admin/articles/:id/preview-token). Cualquier problema con el
   * token es 404, no 401: para el público la nota simplemente no existe.
   */
  async findForPreview(token: string): Promise<ArticleDetailDto> {
    let payload: { sub?: string; kind?: string };
    try {
      // audience "preview": un JWT de sesión robado de otro contexto no sirve
      // acá, y este token no sirve como sesión (JwtStrategy exige "session").
      payload = await this.jwt.verifyAsync(token, {
        issuer: JWT_ISSUER,
        audience: JWT_AUD_PREVIEW,
      });
    } catch {
      throw new NotFoundException('Vista previa no disponible');
    }
    if (payload.kind !== 'preview' || !payload.sub) {
      throw new NotFoundException('Vista previa no disponible');
    }
    const article = await this.prisma.article.findUnique({
      where: { id: payload.sub },
      include: PUBLIC_INCLUDE,
    });
    if (!article || article.status === 'SPIKED') {
      throw new NotFoundException('Vista previa no disponible');
    }
    return toDetailDto(article);
  }
}
