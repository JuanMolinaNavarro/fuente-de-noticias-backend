import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint (o un controller entero) como público: el JwtAuthGuard
 * global lo deja pasar sin token. El default del API es "cerrado" — un
 * controller nuevo sin decorador exige sesión aunque nadie se acuerde de
 * ponerle @UseGuards.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
