import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import type { MediaStoragePort, StoredObject } from './media-storage.port';

/**
 * S3 o compatible (Cloudflare R2, MinIO, DigitalOcean Spaces) vía endpoint.
 * El bucket tiene que ser de lectura pública (o estar detrás de un CDN) y
 * MEDIA_PUBLIC_URL apuntar a esa URL base.
 */
@Injectable()
export class S3StorageAdapter implements MediaStoragePort {
  private readonly client: S3Client;

  constructor(
    private readonly opts: {
      bucket: string;
      region: string;
      endpoint?: string;
      accessKeyId: string;
      secretAccessKey: string;
      publicUrl: string;
    },
  ) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: !!opts.endpoint, // MinIO/R2 usan path-style
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return { key, url: `${this.opts.publicUrl.replace(/\/$/, '')}/${key}` };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }),
    );
  }
}
