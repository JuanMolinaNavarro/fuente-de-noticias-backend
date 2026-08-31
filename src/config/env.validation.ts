import { z } from 'zod';

// Validación en el borde, versión infraestructura: si el entorno está mal
// configurado la app no arranca. Es preferible fallar acá, con un mensaje
// claro, que fallar en runtime en el primer request que use la variable.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  // Fase 2 (ingesta)
  RSS_FEEDS: z.string().optional(),
  // Panel de redacción
  // Vida del token de vista previa (formato de jsonwebtoken: '1h', '30m')
  PREVIEW_TOKEN_TTL: z.string().default('1h'),
  // Horas de vida de un borrador de feed sin publicar antes de purgarlo (cron horario)
  DRAFT_TTL_HOURS: z.coerce.number().int().positive().default(48),
  // Biblioteca de medios: dónde se guardan los binarios
  MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
  MEDIA_LOCAL_DIR: z.string().default('./uploads'), // sólo local
  // URL pública base de los archivos (local: la sirve el propio backend)
  MEDIA_PUBLIC_URL: z.string().url().default('http://localhost:4000/uploads'),
  MEDIA_MAX_MB: z.coerce.number().positive().default(8),
  // Cuota total de subidas por usuario (suma de bytes de sus imágenes):
  // evita que una sola cuenta llene el disco/bucket. 0 = sin cuota.
  MEDIA_USER_QUOTA_MB: z.coerce.number().min(0).default(500),
  // sólo s3 (compatible con R2/MinIO vía S3_ENDPOINT)
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const detalle = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${detalle}`);
  }
  return result.data;
}
