import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe un endpoint a ciertos roles: @Roles('ADMIN'). Sin decorador, alcanza con estar autenticado. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
