import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import type { Env } from '../../config/env.validation';
import { UsersService } from '../users/users.service';
import { JWT_AUD_SESSION, JWT_ISSUER, JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      // Sólo tokens DE SESIÓN: un token de vista previa (audience "preview")
      // comparte secreto pero acá no pasa ni la verificación de passport.
      issuer: JWT_ISSUER,
      audience: JWT_AUD_SESSION,
    });
  }

  /**
   * Se ejecuta DESPUÉS de que passport verificó firma y expiración.
   * Lo que retorna queda disponible como request.user.
   *
   * Consulta la base en cada request (una lectura por PK, barata) en vez de
   * confiar en el rol del token: si a alguien le cambian el rol o lo
   * desactivan, el cambio aplica ya, no dentro de 12 h cuando venza el token.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sesión inválida');
    }
    // Revocación: logout / cambio de contraseña sellan tokensRevokedAt; todo
    // token emitido en ese segundo o antes muere acá (iat viene en segundos
    // truncados, así que el <= incluye el mismo segundo de la revocación:
    // preferimos revocar de más — el caso raro de un login dentro del mismo
    // segundo sólo obliga a loguearse otra vez — que dejar vivo un token
    // robado por truncamiento).
    if (
      user.tokensRevokedAt &&
      payload.iat !== undefined &&
      payload.iat <= Math.floor(user.tokensRevokedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException('Sesión inválida');
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
