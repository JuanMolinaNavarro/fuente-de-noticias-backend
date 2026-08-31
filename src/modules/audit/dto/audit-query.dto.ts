import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

export class AuditQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
