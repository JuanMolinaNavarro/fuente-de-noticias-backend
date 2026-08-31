import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { seconds, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ChangePasswordDto } from '../users/dto/user.dto';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  // Límite estricto contra fuerza bruta: 5 intentos por minuto por IP.
  // Con esto, probar un diccionario de contraseñas pasa de minutos a años;
  // el 6º intento en la ventana recibe 429 Too Many Requests.
  @Public()
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  /**
   * Cerrar sesión revoca los tokens del usuario DEL LADO DEL SERVIDOR
   * (tokensRevokedAt): borrar la cookie en el frontend no alcanza, porque un
   * token robado seguiría siendo válido hasta expirar. Revoca todas las
   * sesiones del usuario (todos sus dispositivos), aceptable para un CMS.
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.users.revokeSessions(user.id);
  }

  // Verifica la clave ACTUAL con bcrypt: sin este límite, una sesión
  // secuestrada tendría 100 intentos/min (el global) para adivinarla.
  // Mismo 5/min que el login.
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.users.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
