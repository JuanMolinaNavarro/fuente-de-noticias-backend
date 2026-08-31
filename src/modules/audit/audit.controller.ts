import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { paginate } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@Query() q: AuditQueryDto) {
    const limit = q.limit ?? 30;
    const { data, total } = await this.audit.list({
      entity: q.entity,
      entityId: q.entityId,
      userId: q.userId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page: q.page,
      limit,
    });
    return paginate(data, total, q.page, limit);
  }
}
