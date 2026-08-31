import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Env } from '../../config/env.validation';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService, JWT_AUD_SESSION, JWT_ISSUER } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        // 12 h: la misma vida útil que tenía la cookie del sistema anterior.
        // issuer + audience "session" por defecto: los tokens de sesión y los
        // de vista previa (que firman su propia audience) quedan separados
        // aunque compartan secreto; cada verificador exige la suya.
        signOptions: {
          expiresIn: '12h',
          issuer: JWT_ISSUER,
          audience: JWT_AUD_SESSION,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  // JwtModule se exporta para que otros módulos firmen tokens (vista previa)
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
