import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Metadatos que acompañan la subida (multipart: vienen como strings). */
export class UploadMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  alt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  @Transform(trim)
  caption?: string;
}

export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  alt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  @Transform(trim)
  caption?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  focalX?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  focalY?: number;
}

export class MediaQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;
}
