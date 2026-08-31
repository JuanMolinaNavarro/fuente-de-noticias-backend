import { Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { MediaStoragePort, StoredObject } from './media-storage.port';

/**
 * Guarda en disco bajo MEDIA_LOCAL_DIR; el backend sirve esa carpeta en
 * /uploads (ver main.ts). La URL pública = MEDIA_PUBLIC_URL + '/' + key.
 */
@Injectable()
export class LocalDiskStorageAdapter implements MediaStoragePort {
  private readonly logger = new Logger(LocalDiskStorageAdapter.name);

  constructor(
    private readonly baseDir: string,
    private readonly publicUrl: string,
  ) {}

  // contentType no aplica en disco (el servidor estático lo infiere de la extensión)
  async put(key: string, body: Buffer): Promise<StoredObject> {
    // La clave viene normalizada por el service (sin '..' ni barras iniciales);
    // igual resolvemos dentro de baseDir como defensa.
    const target = resolve(join(this.baseDir, key));
    if (!target.startsWith(resolve(this.baseDir))) {
      throw new Error('Clave de storage fuera de la carpeta de medios');
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { key, url: `${this.publicUrl.replace(/\/$/, '')}/${key}` };
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(resolve(join(this.baseDir, key)));
    } catch (e) {
      this.logger.warn(`No se pudo borrar ${key}: ${String(e)}`);
    }
  }
}
