import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { trim } from './update-article.dto';

/** Nota original creada desde cero. Sólo el título es obligatorio: el resto
 *  se completa en el editor con PATCH (autosave). */
export class CreateArticleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @Transform(trim)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  kicker?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  summary?: string;

  @IsOptional()
  @IsObject()
  contentJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  @Transform(trim)
  content?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tagNames?: string[];
}
