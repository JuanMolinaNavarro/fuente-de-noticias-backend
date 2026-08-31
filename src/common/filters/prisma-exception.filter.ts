import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Traduce errores conocidos de Prisma a respuestas HTTP con sentido,
 * en un solo lugar, para que los services no repitan try/catch:
 *   P2002 (violación de índice único)  -> 409 Conflict
 *   P2025 (registro no encontrado)     -> 404 Not Found
 *   P2003 (FK a un registro inexistente)-> 400 Bad Request
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const httpError =
      exception.code === 'P2002'
        ? new ConflictException('Ya existe un registro con ese valor único')
        : exception.code === 'P2025'
          ? new NotFoundException('El registro no existe')
          : exception.code === 'P2003'
            ? new BadRequestException(
                'Referencia inválida: el registro relacionado no existe',
              )
            : new InternalServerErrorException();

    response.status(httpError.getStatus()).json(httpError.getResponse());
  }
}
