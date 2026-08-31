/**
 * Puerto de almacenamiento de binarios. El MediaService no sabe si los
 * archivos van a un disco local o a un bucket S3: sólo pide "guardá esto
 * bajo esta clave y decime la URL pública".
 *
 * Adaptadores:
 *  - LocalDiskStorageAdapter: carpeta MEDIA_LOCAL_DIR servida estática por el
 *    propio backend en /uploads (desarrollo, o producción chica en un VPS).
 *  - S3StorageAdapter: bucket S3 o compatible (Cloudflare R2, MinIO) con
 *    MEDIA_PUBLIC_URL apuntando al CDN/bucket público.
 */
export interface StoredObject {
  key: string;
  url: string;
}

export interface MediaStoragePort {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
