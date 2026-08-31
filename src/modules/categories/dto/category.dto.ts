import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @Transform(trim)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug: solo minúsculas, números y guiones',
  })
  slug: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color: hex tipo #1C3A6B' })
  color: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  inNav?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color: hex tipo #1C3A6B' })
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  inNav?: boolean;
}
