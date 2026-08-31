import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Campos editables por la redacción. Todos opcionales (semántica PATCH:
 * lo que no viene, no se toca). Los strings vacíos se normalizan a null en
 * el service para los campos donde "vacío" significa "sin valor".
 *
 * OJO: el ValidationPipe global usa whitelist=true, así que cualquier campo
 * que no esté declarado acá se DESCARTA en silencio. Si agregás una columna
 * editable a Article, tenés que agregarla acá también.
 */
export class UpdateArticleDto {
  // ── Titulación ────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  kicker?: string; // volanta

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  summary?: string; // bajada

  // ── Cuerpo ────────────────────────────────────────────────────────
  /** Documento ProseMirror/Tiptap. Se valida contra DocSchema en el service. */
  @IsOptional()
  @IsObject()
  contentJson?: Record<string, unknown>;

  /** Texto plano. Sólo para clientes viejos: si viene sin contentJson, el
   *  service genera el documento a partir de él. */
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  @Transform(trim)
  content?: string;

  // ── Clasificación ────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @Transform(trim)
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tagNames?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  authorIds?: string[];

  // ── Media / SEO ──────────────────────────────────────────────────
  /** URL externa con licencia (legado/excepción). La vía normal es
   *  featuredMediaId. "" = quitar (por eso el ValidateIf: el string vacío
   *  saltea el IsUrl y el service lo normaliza a null). http(s) solamente:
   *  sin javascript:/data: persistidos como src de imagen. */
  @IsOptional()
  @ValidateIf((o: UpdateArticleDto) => o.imageUrl !== '')
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  @Transform(trim)
  imageUrl?: string;

  /** Imagen destacada de la biblioteca (Media.id). "" = quitar. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  featuredMediaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  @Transform(trim)
  seoDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  socialTitle?: string;

  // ── Editorial ────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  isBreaking?: boolean;

  @IsOptional()
  @IsDateString()
  breakingUntil?: string | null;

  /** Nota que acompaña una corrección sobre una nota publicada. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;

  /**
   * Control de concurrencia optimista: el cliente manda el updatedAt que
   * leyó; si en el medio otro usuario guardó, el service responde 409 en vez
   * de pisar su trabajo en silencio.
   */
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}
