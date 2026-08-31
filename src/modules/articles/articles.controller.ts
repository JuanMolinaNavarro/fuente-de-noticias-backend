import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ArticlesService } from './articles.service';
import { ArticleQueryDto } from './dto/article-query.dto';

/** Público: notas publicadas y vista previa (que valida su propio token JWT
 *  de audiencia "preview" en el service, no el de sesión). */
@Public()
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  list(@Query() query: ArticleQueryDto) {
    return this.articles.findPublished({
      category: query.category,
      page: query.page,
      limit: query.limit ?? 19, // 19 = lo que consume la portada actual
    });
  }

  // Antes de ':slug' para que 'preview' no se interprete como un slug
  @Get('preview/:token')
  preview(@Param('token') token: string) {
    return this.articles.findForPreview(token);
  }

  // Proyección liviana para el sitemap: solo slug y fechas, sin el include
  // pesado ni la paginación de /articles. También antes de ':slug'.
  @Get('slugs')
  slugs() {
    return this.articles.listSlugs();
  }

  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.articles.findBySlug(slug);
  }

  @Get(':slug/related')
  related(
    @Param('slug') slug: string,
    @Query('limit', new DefaultValuePipe(4), ParseIntPipe) limit: number,
  ) {
    return this.articles.findRelated(slug, Math.min(limit, 10));
  }
}
