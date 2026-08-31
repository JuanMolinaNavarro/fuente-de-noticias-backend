import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

/** Lo que JwtStrategy.validate() deja en request.user. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

/** Inyecta el usuario autenticado en el handler: método(@CurrentUser() user: AuthUser). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
