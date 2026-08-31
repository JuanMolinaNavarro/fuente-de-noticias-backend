import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { MediaUrlsInterceptor } from '../media/media-urls.interceptor';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageQueryDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { AdminArticlesService } from './admin-articles.service';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { PublishDto } from './dto/publish.dto';
import { ReturnDto } from './dto/return.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

/**
 * Las transiciones son POST /:id/accion (no PATCH de status): el estado no es
 * un campo editable, es el resultado de una acción de dominio con reglas.
 *
 * Dos capas de autorización:
 *  - @Roles(...) acá: lo grueso (un REDACTOR nunca llega a /publish).
 *  - article-policy en el service: lo fino (un REDACTOR sólo edita SUS notas).
 * Sin @Roles = cualquier usuario autenticado (los tres roles).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
// Las URLs de media salen relativas hacia el panel (ver media-url.ts)
@UseInterceptors(MediaUrlsInterceptor)
@Controller('admin/articles')
export class AdminArticlesController {
  constructor(private readonly admin: AdminArticlesService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get()
  list(@Query() query: AdminListQueryDto) {
    // Defaults del panel: 15 publicadas, 20 en el resto de las bandejas
    return this.admin.list(
      query,
      query.limit ?? (query.status === 'PUBLISHED' ? 15 : 20),
    );
  }

  @Post()
  create(@Body() dto: CreateArticleDto, @CurrentUser() user: AuthUser) {
    return this.admin.create(dto, user);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.admin.getById(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.update(id, dto, user);
  }

  // ── Transiciones ─────────────────────────────────────────────────

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.admin.submit(id, user);
  }

  @Roles('ADMIN', 'EDITOR')
  @Post(':id/return')
  return(
    @Param('id') id: string,
    @Body() dto: ReturnDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.return(id, dto.note, user);
  }

  @Roles('ADMIN', 'EDITOR')
  @Post(':id/publish')
  publish(
    @Param('id') id: string,
    @Body() dto: PublishDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.publish(id, dto.scheduledAt, user);
  }

  @Roles('ADMIN', 'EDITOR')
  @Post(':id/unschedule')
  unschedule(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.admin.unschedule(id, user);
  }

  @Roles('ADMIN', 'EDITOR')
  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.admin.unpublish(id, user);
  }

  @Post(':id/spike')
  spike(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.admin.spike(id, user);
  }

  @Roles('ADMIN', 'EDITOR')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.admin.restore(id, user);
  }

  // ── Revisiones ───────────────────────────────────────────────────

  @Get(':id/revisions')
  revisions(
    @Param('id') id: string,
    @Query() q: PageQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.listRevisions(id, q.page, q.limit ?? 20, user);
  }

  @Get(':id/revisions/:rid')
  revision(
    @Param('id') id: string,
    @Param('rid') rid: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.getRevision(id, rid, user);
  }

  @Post(':id/revisions/:rid/restore')
  restoreRevision(
    @Param('id') id: string,
    @Param('rid') rid: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.restoreRevision(id, rid, user);
  }

  // ── Vista previa ─────────────────────────────────────────────────

  @Post(':id/preview-token')
  previewToken(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.admin.previewToken(id, user);
  }
}
