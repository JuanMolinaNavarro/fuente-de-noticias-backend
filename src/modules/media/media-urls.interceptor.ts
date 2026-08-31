import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { relativizarSalida } from './media-url';

/**
 * Relativiza las URLs de la biblioteca de medios en las respuestas del panel
 * (ver media-url.ts para el porqué).
 *
 * Es un interceptor y no un mapper por endpoint porque los controllers del
 * admin devuelven filas de Prisma desde muchos lugares distintos: una
 * preocupación transversal (afecta a todos por igual, sin lógica propia de
 * cada uno) se resuelve una sola vez en el "caño" de salida. El wire público
 * en cambio ya tiene su mapper explícito (article-response.dto.ts) y
 * relativiza ahí, donde se define su contrato.
 */
@Injectable()
export class MediaUrlsInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => relativizarSalida(data)));
  }
}
