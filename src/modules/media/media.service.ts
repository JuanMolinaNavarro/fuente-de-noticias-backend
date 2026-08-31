import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Media, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { paginate } from '../../common/dto/pagination.dto';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  MEDIA_STORAGE,
  type MediaStoragePort,
} from './storage/media-storage.port';

/** Formatos de entrada aceptados (lo demás → 400). */
export const MIME_PERMITIDOS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
/** Ancho máximo de la versión principal y de la miniatura. */
const ANCHO_MAX = 1600;
const ANCHO_THUMB = 800;

export interface SubidaInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  alt?: string;
  caption?: string;
  uploadedById: string;
}

/**
 * Biblioteca de medios. Cada subida produce DOS archivos webp (principal ≤1600
 * px y miniatura ≤800 px) a partir del original: servimos siempre un formato
 * moderno y liviano, y no guardamos el original (a esta escala no hace falta
 * y ahorra espacio; si algún día se necesita, es un cambio local acá).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly quotaBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    config: ConfigService<Env, true>,
  ) {
    this.quotaBytes =
      config.get('MEDIA_USER_QUOTA_MB', { infer: true }) * 1024 * 1024;
  }

  async upload(input: SubidaInput): Promise<Media> {
    if (!MIME_PERMITIDOS.has(input.mimeType)) {
      throw new BadRequestException(
        'Formato no admitido: sólo JPG, PNG o WebP',
      );
    }
    await this.assertQuota(input.uploadedById);
    // sharp valida que el contenido sea realmente una imagen (no confiamos en
    // el Content-Type del cliente): si no puede leerla, 400.
    let meta: sharp.Metadata;
    try {
      meta = await sharp(input.buffer).metadata();
    } catch {
      throw new BadRequestException('El archivo no es una imagen válida');
    }
    const orient = sharp(input.buffer).rotate(); // respeta EXIF orientation

    const [principal, thumb] = await Promise.all([
      orient
        .clone()
        .resize({ width: ANCHO_MAX, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true }),
      orient
        .clone()
        .resize({ width: ANCHO_THUMB, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer({ resolveWithObject: true }),
    ]);

    // Clave: año/mes/uuid → carpetas que no crecen sin límite, sin nombres de
    // usuario (evita colisiones y caracteres raros del nombre original).
    const now = new Date();
    const base = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const [obj, objThumb] = await Promise.all([
      this.storage.put(`${base}.webp`, principal.data, 'image/webp'),
      this.storage.put(`${base}-sm.webp`, thumb.data, 'image/webp'),
    ]);

    const media = await this.prisma.media.create({
      data: {
        storageKey: obj.key,
        url: obj.url,
        thumbUrl: objThumb.url,
        mimeType: 'image/webp',
        bytes: principal.info.size,
        width: principal.info.width,
        height: principal.info.height,
        alt: input.alt || null,
        caption: input.caption || null,
        uploadedById: input.uploadedById,
      },
    });
    await this.audit.log({
      entity: 'media',
      entityId: media.id,
      action: 'upload',
      userId: input.uploadedById,
      diff: {
        originalName: input.originalName,
        original: {
          mime: input.mimeType,
          width: meta.width,
          height: meta.height,
        },
      },
    });
    this.logger.log(`Subida ${media.id}: ${input.originalName} → ${obj.key}`);
    return media;
  }

  async list(q: { q?: string; page: number; limit: number }) {
    const where: Prisma.MediaWhereInput = q.q
      ? {
          OR: [
            { caption: { contains: q.q, mode: 'insensitive' } },
            { alt: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.media.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { uploadedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.media.count({ where }),
    ]);
    return paginate(data, total, q.page, q.limit);
  }

  async getById(id: string) {
    const m = await this.prisma.media.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        _count: { select: { featuredIn: true } },
      },
    });
    if (!m) throw new NotFoundException('Imagen no encontrada');
    return m;
  }

  /**
   * Borra ficha + binarios (principal y miniatura). Se niega si la imagen es
   * la destacada de alguna nota (409): primero hay que despegarla. Limitación
   * conocida: no detecta imágenes embebidas en el CUERPO de una nota (el
   * contentJson guarda URLs, no referencias); en ese caso la nota mostrará
   * el hueco de una imagen rota — por eso el endpoint es de EDITOR/ADMIN.
   */
  async remove(id: string, actorId: string) {
    const media = await this.getById(id);
    if (media._count.featuredIn > 0) {
      throw new ConflictException(
        `La imagen es la destacada de ${media._count.featuredIn} nota(s): quitala de ahí antes de borrarla.`,
      );
    }
    await this.prisma.media.delete({ where: { id } });
    // Binarios al final: si el delete de la fila falla, no queda una ficha
    // apuntando a archivos ya borrados. La miniatura comparte base de clave.
    await this.storage.remove(media.storageKey);
    await this.storage.remove(
      media.storageKey.replace(/\.webp$/, '-sm.webp'),
    );
    await this.audit.log({
      entity: 'media',
      entityId: id,
      action: 'delete',
      userId: actorId,
      diff: { storageKey: media.storageKey, bytes: media.bytes },
    });
    this.logger.log(`Borrada ${id} (${media.storageKey})`);
  }

  /** Cuota por usuario: la suma de bytes de sus subidas no supera la cuota. */
  private async assertQuota(userId: string) {
    if (this.quotaBytes <= 0) return; // 0 = sin cuota
    const usado = await this.prisma.media.aggregate({
      where: { uploadedById: userId },
      _sum: { bytes: true },
    });
    if ((usado._sum.bytes ?? 0) >= this.quotaBytes) {
      throw new ForbiddenException(
        `Alcanzaste tu cuota de ${this.quotaBytes / 1024 / 1024} MB de imágenes. Pedile a un admin que borre las que no se usan.`,
      );
    }
  }

  async update(
    id: string,
    data: {
      alt?: string;
      caption?: string;
      focalX?: number;
      focalY?: number;
    },
    actorId: string,
  ) {
    await this.getById(id);
    const media = await this.prisma.media.update({
      where: { id },
      data: {
        ...(data.alt !== undefined && { alt: data.alt || null }),
        ...(data.caption !== undefined && { caption: data.caption || null }),
        ...(data.focalX !== undefined && { focalX: data.focalX }),
        ...(data.focalY !== undefined && { focalY: data.focalY }),
      },
    });
    await this.audit.log({
      entity: 'media',
      entityId: id,
      action: 'update',
      userId: actorId,
      diff: { fields: Object.keys(data) },
    });
    return media;
  }
}
