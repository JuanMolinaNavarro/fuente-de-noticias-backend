import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Lo que sale por el wire: nunca el passwordHash. */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

const BCRYPT_ROUNDS = 10;

export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * SOLO para el login: es el único camino que devuelve el passwordHash
   * (AuthService lo necesita para bcrypt.compare). El nombre lo grita a
   * propósito: nunca devolver este objeto por el wire.
   */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Proyección segura (sin passwordHash): apta para JwtStrategy y /auth/me. */
  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        tokensRevokedAt: true,
      },
    });
  }

  /**
   * Invalida todos los JWT vigentes del usuario (logout, cambio o blanqueo de
   * contraseña): JwtStrategy rechaza los emitidos antes de este instante.
   */
  async revokeSessions(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { tokensRevokedAt: new Date() },
    });
  }

  /**
   * Sólo id y nombre de los activos: para elegir la firma de una nota.
   * La cuenta técnica de arranque (SEED_ADMIN_EMAIL) queda afuera: existe para
   * dar de alta la redacción, no es una persona que firme notas. Sigue pudiendo
   * editar y publicar; lo único que no puede es aparecer en la firma pública.
   */
  directory(): Promise<{ id: string; name: string }[]> {
    const cuentaDeArranque = this.config.get('SEED_ADMIN_EMAIL', {
      infer: true,
    });
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(cuentaDeArranque ? { email: { not: cuentaDeArranque } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async list(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return users.map(toUserDto);
  }

  async create(
    dto: { email: string; name: string; password: string; role?: Role },
    actorId: string,
  ): Promise<UserDto> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        role: dto.role ?? 'REDACTOR',
      },
    });
    await this.audit.log({
      entity: 'user',
      entityId: user.id,
      action: 'create',
      userId: actorId,
      diff: { email: user.email, role: user.role },
    });
    return toUserDto(user);
  }

  async update(
    id: string,
    dto: { name?: string; role?: Role; isActive?: boolean },
    actorId: string,
  ): Promise<UserDto> {
    const before = await this.getOrThrow(id);
    // Un admin no puede quitarse a sí mismo el rol ni desactivarse: evita
    // quedarse sin ningún administrador por un clic.
    if (
      id === actorId &&
      ((dto.role && dto.role !== 'ADMIN') || dto.isActive === false)
    ) {
      throw new ForbiddenException(
        'No podés quitarte el rol de administrador ni desactivar tu propia cuenta',
      );
    }
    const user = await this.prisma.user.update({ where: { id }, data: dto });
    await this.audit.log({
      entity: 'user',
      entityId: id,
      action: 'update',
      userId: actorId,
      diff: {
        before: {
          name: before.name,
          role: before.role,
          isActive: before.isActive,
        },
        after: { name: user.name, role: user.role, isActive: user.isActive },
      },
    });
    return toUserDto(user);
  }

  /** ADMIN blanquea la contraseña de otro usuario. */
  async setPassword(id: string, password: string, actorId: string) {
    await this.getOrThrow(id);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // tokensRevokedAt: si se blanquea es porque la cuenta quedó comprometida
    // o inaccesible; las sesiones viejas no deben sobrevivir al blanqueo.
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, tokensRevokedAt: new Date() },
    });
    await this.audit.log({
      entity: 'user',
      entityId: id,
      action: 'setPassword',
      userId: actorId,
    });
  }

  /** El usuario cambia la suya: exige la actual. */
  async changePassword(id: string, current: string, next: string) {
    const user = await this.getOrThrow(id);
    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    const passwordHash = await bcrypt.hash(next, BCRYPT_ROUNDS);
    // Cambiar la contraseña revoca TODAS las sesiones (incluida la actual):
    // si alguien robó el token, el cambio de clave lo mata en el acto en vez
    // de dejarlo vivo hasta 12 h. El usuario vuelve a loguearse una vez.
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, tokensRevokedAt: new Date() },
    });
    await this.audit.log({
      entity: 'user',
      entityId: id,
      action: 'changePassword',
      userId: id,
    });
  }

  private async getOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }
}
