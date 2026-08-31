import { IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

export class ArticleQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  category?: string;
}
