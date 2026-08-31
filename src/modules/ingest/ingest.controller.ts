import { Controller, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { IngestService } from './ingest.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  /** Disparo manual — reemplaza al viejo `npm run ingest`. Solo ADMIN. */
  @Roles('ADMIN')
  @Post('run')
  run() {
    return this.ingest.run();
  }
}
