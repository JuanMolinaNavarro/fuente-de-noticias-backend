import { ArticleOrigin, ArticleStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { trim } from './update-article.dto';

export const ADMIN_SORT_FIELDS = [
  'updatedAt',
  'publishedAt',
  'fetchedAt',
  'scheduledAt',
  'title',
] as const;
export type AdminSortField = (typeof ADMIN_SORT_FIELDS)[number];

/** Filtros de la bandeja. Todos combinables. */
export class AdminListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @IsOptional()
  @IsEnum(ArticleOrigin)
  origin?: ArticleOrigin;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /** id del usuario que creó la nota (dueño), no la firma pública */
  @IsOptional()
  @IsString()
  authorId?: string;

  /** búsqueda libre en título, bajada, volanta y título original del feed */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  q?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(ADMIN_SORT_FIELDS)
  sort?: AdminSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
