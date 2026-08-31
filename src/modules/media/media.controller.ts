import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Env } from '../../config/env.validation';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MediaQueryDto, UpdateMediaDto, UploadMediaDto } from './dto/media.dto';
import { MediaUrlsInterceptor } from './media-urls.interceptor';
import { MediaService, MIME_PERMITIDOS } from './media.service';

/** Biblioteca de medios: cualquier rol sube (con cuota), busca y edita
 *  metadatos. DELETE sólo EDITOR/ADMIN, y el service se niega si la imagen
 *  es la destacada de alguna nota. */
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(MediaUrlsInterceptor)
@Controller('admin/media')
export class MediaController {
  private readonly maxBytes: number;

  constructor(
    private readonly media: MediaService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MEDIA_MAX_MB', { infer: true }) * 1024 * 1024;
  }

  /**
   * multipart/form-data: campo `file` + alt/caption.
   * El límite de tamaño lo impone multer (413 si lo supera) y el tipo se
   * filtra dos veces: acá por Content-Type y en el service por contenido real.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // El límite de tamaño (MEDIA_MAX_MB) viene del MulterModule del módulo
      // (media.module.ts): multer corta la subida y responde 413 solo.
      fileFilter: (_req, file, cb) => {
        if (MIME_PERMITIDOS.has(file.mimetype)) cb(null, true);
        else
          cb(
            new BadRequestException(
              'Formato no admitido: sólo JPG, PNG o WebP',
            ),
            false,
          );
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadMediaDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Falta el archivo (campo "file")');
    if (file.size > this.maxBytes) {
      throw new BadRequestException(
        `La imagen supera el máximo de ${this.maxBytes / 1024 / 1024} MB`,
      );
    }
    return this.media.upload({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      alt: dto.alt,
      caption: dto.caption,
      uploadedById: user.id,
    });
  }

  @Get()
  list(@Query() q: MediaQueryDto) {
    return this.media.list({ q: q.q, page: q.page, limit: q.limit ?? 24 });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.media.getById(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.media.update(id, dto, user.id);
  }

  @Roles('ADMIN', 'EDITOR')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.media.remove(id, user.id);
  }
}
