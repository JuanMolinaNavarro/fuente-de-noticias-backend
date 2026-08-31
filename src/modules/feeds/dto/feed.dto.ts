import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateFeedDto {
  @IsUrl({ require_protocol: true })
  url: string;

  /** id de la categoría fija (opcional: los feeds generales categorizan por regex) */
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateFeedDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
