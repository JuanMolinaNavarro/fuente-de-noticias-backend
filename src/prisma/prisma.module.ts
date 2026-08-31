import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global: cualquier módulo puede inyectar PrismaService sin re-importar
// este módulo. Se usa con moderación; para el acceso a datos es el caso típico.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
