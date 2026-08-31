import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HomeZone, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ArticlePublicDto,
  PUBLIC_INCLUDE,
  toPublicDto,
} from '../articles/dto/article-response.dto';
import { AuditService } from '../audit/audit.service';

/** Cupos por zona = lo que la portada actual ya mostraba (1 + 6 + 12 = 19). */
export const CUPOS: Record<HomeZone, number> = {
  PRINCIPAL: 1,
  DESTACADAS: 6,
  MAS_NOTICIAS: 12,
};
export const ZONAS: HomeZone[] = ['PRINCIPAL', 'DESTACADAS', 'MAS_NOTICIAS'];

export interface SlotSnapshot {
  zone: HomeZone;
  position: number;
  articleId: string;
  pinned: boolean;
}

export interface PortadaPublica {
  principal: ArticlePublicDto | null;
  destacadas: ArticlePublicDto[];
  mas: ArticlePublicDto[];
  breaking: ArticlePublicDto[];
  /** cuándo se publicó la última versión curada; null = todo cronológico */
  curadaAt: Date | null;
}

/**
 * Portada curada (patrón "Fronts" del Guardian): el panel arma un borrador
 * por zonas y lo publica explícitamente como una versión; el sitio sirve la
 * última versión publicada. Donde una zona quede corta (slot vacío, nota
 * despublicada después), se rellena con las publicadas más recientes que no
 * estén ya en la portada — así la portada nunca queda con huecos.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ── Panel ───────────────────────────────────────────────────────── */

  /** Borrador actual con las notas resueltas (para el curador). */
  async getDraft() {
    const slots = await this.prisma.homeSlot.findMany({
      orderBy: [{ zone: 'asc' }, { position: 'asc' }],
      include: { article: { include: PUBLIC_INCLUDE } },
    });
    const ultima = await this.prisma.homeLayoutVersion.findFirst({
      orderBy: { publishedAt: 'desc' },
      include: { publishedBy: { select: { id: true, name: true } } },
    });
    const porZona = Object.fromEntries(
      ZONAS.map((z) => [z, [] as unknown[]]),
    ) as Record<
      HomeZone,
      {
        position: number;
        pinned: boolean;
        article: ArticlePublicDto & { status: string };
      }[]
    >;
    for (const s of slots) {
      porZona[s.zone].push({
        position: s.position,
        pinned: s.pinned,
        article: { ...toPublicDto(s.article), status: s.article.status },
      });
    }
    // ¿el borrador difiere de la última versión publicada?
    const actual = JSON.stringify(
      slots.map((s) => [s.zone, s.position, s.articleId]),
    );
    const publicado = ultima
      ? JSON.stringify(
          (ultima.snapshot as unknown as SlotSnapshot[]).map((s) => [
            s.zone,
            s.position,
            s.articleId,
          ]),
        )
      : '[]';
    return {
      zonas: porZona,
      cupos: CUPOS,
      ultimaVersion: ultima
        ? {
            id: ultima.id,
            publishedAt: ultima.publishedAt,
            publishedBy: ultima.publishedBy,
          }
        : null,
      cambiosSinPublicar: actual !== publicado,
    };
  }

  /** Reemplaza los slots de UNA zona con la lista dada (orden = posición). */
  async setSlots(zone: HomeZone, articleIds: string[], actorId: string) {
    const ids = [...new Set(articleIds)];
    if (ids.length > CUPOS[zone]) {
      throw new BadRequestException(
        `La zona ${zone} admite hasta ${CUPOS[zone]} notas`,
      );
    }
    if (ids.length) {
      const existentes = await this.prisma.article.count({
        where: { id: { in: ids }, status: { in: ['PUBLISHED', 'SCHEDULED'] } },
      });
      if (existentes !== ids.length) {
        throw new BadRequestException(
          'Sólo se pueden ubicar notas publicadas o programadas',
        );
      }
    }
    // Una nota no puede estar en dos zonas: se saca de las otras
    await this.prisma.$transaction([
      this.prisma.homeSlot.deleteMany({ where: { zone } }),
      ...(ids.length
        ? [
            this.prisma.homeSlot.deleteMany({
              where: { articleId: { in: ids } },
            }),
          ]
        : []),
      ...ids.map((articleId, position) =>
        this.prisma.homeSlot.create({ data: { zone, position, articleId } }),
      ),
    ]);
    await this.audit.log({
      entity: 'home',
      entityId: zone,
      action: 'setSlots',
      userId: actorId,
      diff: { articleIds: ids },
    });
    return this.getDraft();
  }

  /** Congela el borrador como versión publicada. */
  async publish(actorId: string) {
    const slots = await this.prisma.homeSlot.findMany({
      orderBy: [{ zone: 'asc' }, { position: 'asc' }],
    });
    const snapshot: SlotSnapshot[] = slots.map((s) => ({
      zone: s.zone,
      position: s.position,
      articleId: s.articleId,
      pinned: s.pinned,
    }));
    const v = await this.prisma.homeLayoutVersion.create({
      data: {
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        publishedById: actorId,
      },
      include: { publishedBy: { select: { id: true, name: true } } },
    });
    await this.audit.log({
      entity: 'home',
      entityId: v.id,
      action: 'publish',
      userId: actorId,
      diff: { slots: snapshot.length },
    });
    return v;
  }

  async versions(limit = 20) {
    return this.prisma.homeLayoutVersion.findMany({
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: { publishedBy: { select: { id: true, name: true } } },
    });
  }

  /** Vuelve a una versión: la copia al borrador y la publica como versión nueva. */
  async republish(versionId: string, actorId: string) {
    const v = await this.prisma.homeLayoutVersion.findUnique({
      where: { id: versionId },
    });
    if (!v) throw new NotFoundException('Versión de portada no encontrada');
    const snapshot = v.snapshot as unknown as SlotSnapshot[];
    await this.prisma.$transaction([
      this.prisma.homeSlot.deleteMany({}),
      ...snapshot.map((s) =>
        this.prisma.homeSlot.create({
          data: {
            zone: s.zone,
            position: s.position,
            articleId: s.articleId,
            pinned: s.pinned,
          },
        }),
      ),
    ]);
    return this.publish(actorId);
  }

  /* ── Público ─────────────────────────────────────────────────────── */

  /**
   * La portada tal como la ve el lector: última versión publicada, filtrando
   * las notas que ya no están PUBLISHED, y rellenando cada zona con las
   * publicadas más recientes que no estén en ninguna otra zona.
   */
  async resolvePublic(): Promise<PortadaPublica> {
    const ultima = await this.prisma.homeLayoutVersion.findFirst({
      orderBy: { publishedAt: 'desc' },
    });
    const snapshot =
      (ultima?.snapshot as unknown as SlotSnapshot[] | undefined) ?? [];

    // 1) notas curadas que siguen publicadas, en su orden
    const ids = [...new Set(snapshot.map((s) => s.articleId))];
    const curadas = ids.length
      ? await this.prisma.article.findMany({
          where: { id: { in: ids }, status: 'PUBLISHED' },
          include: PUBLIC_INCLUDE,
        })
      : [];
    const porId = new Map(curadas.map((a) => [a.id, a]));
    const usados = new Set<string>();
    const zona = (z: HomeZone) =>
      snapshot
        .filter((s) => s.zone === z)
        .sort((a, b) => a.position - b.position)
        .map((s) => porId.get(s.articleId))
        .filter((a): a is NonNullable<typeof a> => !!a && !usados.has(a.id))
        .map((a) => {
          usados.add(a.id);
          return a;
        });
    const principal = zona('PRINCIPAL');
    const destacadas = zona('DESTACADAS');
    const mas = zona('MAS_NOTICIAS');

    // 2) relleno cronológico para lo que falte
    const faltan =
      CUPOS.PRINCIPAL -
      principal.length +
      CUPOS.DESTACADAS -
      destacadas.length +
      CUPOS.MAS_NOTICIAS -
      mas.length;
    if (faltan > 0) {
      const relleno = await this.prisma.article.findMany({
        where: { status: 'PUBLISHED', id: { notIn: [...usados] } },
        include: PUBLIC_INCLUDE,
        orderBy: { publishedAt: 'desc' },
        take: faltan,
      });
      const cola = [...relleno];
      const completar = (arr: typeof relleno, cupo: number) => {
        while (arr.length < cupo && cola.length) arr.push(cola.shift()!);
      };
      completar(principal, CUPOS.PRINCIPAL);
      completar(destacadas, CUPOS.DESTACADAS);
      completar(mas, CUPOS.MAS_NOTICIAS);
    }

    // 3) última hora vigente
    const breaking = await this.prisma.article.findMany({
      where: {
        status: 'PUBLISHED',
        isBreaking: true,
        OR: [{ breakingUntil: null }, { breakingUntil: { gt: new Date() } }],
      },
      include: PUBLIC_INCLUDE,
      orderBy: { publishedAt: 'desc' },
      take: 3,
    });

    return {
      principal: principal[0] ? toPublicDto(principal[0]) : null,
      destacadas: destacadas.map(toPublicDto),
      mas: mas.map(toPublicDto),
      breaking: breaking.map(toPublicDto),
      curadaAt: ultima?.publishedAt ?? null,
    };
  }
}
