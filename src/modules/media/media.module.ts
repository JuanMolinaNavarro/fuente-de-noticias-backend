import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../../config/env.validation';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalDiskStorageAdapter } from './storage/local-disk-storage.adapter';
import { MEDIA_STORAGE } from './storage/media-storage.port';
import { S3StorageAdapter } from './storage/s3-storage.adapter';

@Module({
  imports: [
    // El límite de multer sale de MEDIA_MAX_MB (antes estaba hardcodeado en
    // 8 MB y la variable no tenía efecto). registerAsync porque el valor
    // recién existe cuando ConfigModule terminó de validar el entorno.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: {
          fileSize: config.get('MEDIA_MAX_MB', { infer: true }) * 1024 * 1024,
          files: 1,
        },
      }),
    }),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      // El storage se elige UNA vez al arrancar según MEDIA_STORAGE.
      // El service no sabe cuál es.
      provide: MEDIA_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const publicUrl = config.get('MEDIA_PUBLIC_URL', { infer: true });
        if (config.get('MEDIA_STORAGE', { infer: true }) === 's3') {
          const bucket = config.get('S3_BUCKET', { infer: true });
          const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
          const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', {
            infer: true,
          });
          if (!bucket || !accessKeyId || !secretAccessKey) {
            throw new Error(
              'MEDIA_STORAGE=s3 requiere S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY',
            );
          }
          return new S3StorageAdapter({
            bucket,
            accessKeyId,
            secretAccessKey,
            region: config.get('S3_REGION', { infer: true }),
            endpoint: config.get('S3_ENDPOINT', { infer: true }),
            publicUrl,
          });
        }
        return new LocalDiskStorageAdapter(
          config.get('MEDIA_LOCAL_DIR', { infer: true }),
          publicUrl,
        );
      },
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
