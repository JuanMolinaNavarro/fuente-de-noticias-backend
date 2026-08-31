import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: string; // id del usuario ("subject", nombre estándar del claim JWT)
  email: string;
  role: string;
  iat?: number; // emitido a (epoch en segundos); lo agrega jsonwebtoken al firmar
}

/**
 * Audiencias de los dos tipos de token que firma la app con JWT_SECRET.
 * Separarlas hace imposible usar un token de vista previa como sesión (o al
 * revés) aunque compartan secreto: cada verificador exige la suya.
 */
export const JWT_ISSUER = 'fuente-de-noticias';
export const JWT_AUD_SESSION = 'session';
export const JWT_AUD_PREVIEW = 'preview';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmailWithPassword(email);
    // bcrypt.compare es de tiempo constante — a diferencia del `===` del
    // sistema anterior, no filtra información por timing.
    // Se compara SIEMPRE (aun sin usuario) para no revelar si el email existe.
    const hash = user?.passwordHash ?? '$2b$10$invalidsaltinvalidsaltinvalid';
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    // Misma respuesta que credenciales inválidas: no revelamos que existe
    if (!user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: this.toDto(user),
    };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.toDto(user);
  }

  /** El passwordHash jamás sale por el wire. */
  private toDto(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    };
  }
}
