import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Rechaza con 401 todo request sin un Bearer token válido. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
