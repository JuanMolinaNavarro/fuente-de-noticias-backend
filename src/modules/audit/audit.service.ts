import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  entity: 'article' | 'user' | 'feed' | 'category' | 'media' | 'home';
  entityId: string;
  action: string;
  userId?: string | null;
  diff?: Prisma.InputJsonValue | null;
}

/**
 * Bitácora de acciones. Se llama EXPLÍCITAMENTE desde los services (y no
 * desde un interceptor genérico) porque el interceptor sólo ve "PATCH /x" —
 * no sabe qué acción de dominio ocurrió (¿publicó? ¿devolvió?) ni qué cambió.
 * Registrar es una decisión del caso de uso, igual que persistir.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditEntry) {
    return this.prisma.auditLog.create({
      data: {
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        userId: entry.userId ?? null,
        diff: entry.diff ?? Prisma.JsonNull,
      },
    });
  }

  async list(params: {
    entity?: string;
    entityId?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    const { entity, entityId, userId, from, to, page, limit } = params;
    const where: Prisma.AuditLogWhereInput = {
      ...(entity && { entity }),
      ...(entityId && { entityId }),
      ...(userId && { userId }),
      ...((from || to) && { createdAt: { gte: from, lte: to } }),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total };
  }
}
