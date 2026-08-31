import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

// Global: casi todos los módulos registran acciones; importarlo en cada uno
// sería ruido sin beneficio (igual que PrismaModule).
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
