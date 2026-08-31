import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/**
 * Autorización (¿puede?) separada de autenticación (¿quién es?).
 * Corre después de JwtAuthGuard: lee los roles exigidos por @Roles()
 * y los compara con el rol del usuario del token.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Sin @Roles() el endpoint solo exige estar autenticado
    if (!required || required.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user: AuthUser | undefined }>();
    return user != null && required.includes(user.role);
  }
}
