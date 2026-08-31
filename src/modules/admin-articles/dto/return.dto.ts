import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from './update-article.dto';

export class ReturnDto {
  /** Motivo para el redactor. Obligatorio: devolver sin explicar no ayuda. */
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  @Transform(trim)
  note!: string;
}
