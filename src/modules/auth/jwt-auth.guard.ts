import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

/**
 * Rechaza con 401 todo request sin un Bearer token válido.
 *
 * Registrado como APP_GUARD (app.module.ts): aplica a TODOS los endpoints
 * por defecto y solo @Public() lo exceptúa. Así, olvidarse un decorador en
 * un controller nuevo deja el endpoint cerrado, no abierto.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // getAllAndOverride: el metadata del método pisa al del controller.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
