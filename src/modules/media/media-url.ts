/**
 * Las URLs de la biblioteca de medios se guardan ABSOLUTAS en la base
 * (MEDIA_PUBLIC_URL + key en el momento de subir). Eso las congela con el
 * dominio que estaba activo ese día: si el sitio después se mira por otro
 * host (IP de LAN, ngrok, un dominio nuevo), las imágenes apuntan a un
 * origen viejo y no cargan.
 *
 * La salida pública las RELATIVIZA: como frontend y backend comparten origen
 * detrás del reverse proxy (/uploads/* → backend), `/uploads/foo.webp` la
 * resuelve el browser contra el dominio por el que entró, sea cual sea.
 *
 * Solo se tocan las URLs cuyo path empieza con /uploads/ (media propia en
 * disco). Un bucket S3/CDN u otra imagen externa vive en otro origen de
 * verdad y debe seguir absoluta.
 */
export function relativizarMediaUrl<T extends string | null | undefined>(
  url: T,
): T {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/uploads/')) return u.pathname as T;
  } catch {
    // ya era relativa o no es una URL: se devuelve tal cual
  }
  return url;
}

/**
 * Recorre el contentJson (doc de TipTap) y relativiza los `src` de las
 * imágenes incrustadas en el cuerpo: también quedaron guardadas absolutas
 * al momento de insertarlas en el editor.
 */
export function relativizarContenido(nodo: unknown): unknown {
  return relativizarSalida(nodo, ['src']);
}

/** Campos que pueden llevar una URL de la biblioteca de medios. */
const CLAVES_MEDIA = ['url', 'thumbUrl', 'src', 'imageUrl'];

/**
 * Deep-walk genérico: relativiza cualquier campo de media en una estructura
 * arbitraria. Lo usa el MediaUrlsInterceptor para las respuestas del panel,
 * que devuelven filas de Prisma desde muchos endpoints distintos (mapearlas
 * una por una sería repetir el mismo código en cada return).
 */
export function relativizarSalida(
  nodo: unknown,
  claves: string[] = CLAVES_MEDIA,
): unknown {
  if (Array.isArray(nodo)) return nodo.map((n) => relativizarSalida(n, claves));
  if (nodo !== null && typeof nodo === 'object') {
    if (nodo instanceof Date) return nodo;
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(nodo)) {
      salida[clave] =
        claves.includes(clave) && typeof valor === 'string'
          ? relativizarMediaUrl(valor)
          : relativizarSalida(valor, claves);
    }
    return salida;
  }
  return nodo;
}
