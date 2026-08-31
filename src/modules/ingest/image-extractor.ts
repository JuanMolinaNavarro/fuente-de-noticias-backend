import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Injectable, Logger } from '@nestjs/common';
import type { FeedItem } from './feed-parser.adapter';

/** Tope de HTML a descargar de la página original: el og:image vive en el
 *  <head>, así que 200 KB alcanzan de sobra. */
const MAX_HTML_BYTES = 200_000;

/**
 * Estrategia en cascada para conseguir la imagen de referencia:
 * enclosure → media:content/thumbnail → primer <img> del HTML → og:image
 * scrapeada de la página original (último recurso, cuesta un fetch).
 */
@Injectable()
export class ImageExtractor {
  private readonly logger = new Logger(ImageExtractor.name);

  async extract(item: FeedItem): Promise<string | null> {
    if (item.enclosureImage) return item.enclosureImage;
    if (item.mediaImage) return item.mediaImage;

    const m = item.contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m?.[1]) return m[1];

    return this.fromPage(item.link);
  }

  private async fromPage(url: string): Promise<string | null> {
    try {
      // La URL viene del XML de un feed de TERCEROS: sin este control, un
      // feed comprometido podría hacer que el backend le pegue a la red
      // interna (Postgres, metadata del cloud, su propio API admin). SSRF.
      if (!(await this.esUrlPublica(url))) {
        this.logger.warn(`Ingesta: URL no pública rechazada: ${url}`);
        return null;
      }
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (FuenteDeNoticias ingestor)' },
        // Sin seguir redirects: un 302 a http://localhost evadiría el
        // control de arriba (se valida el destino, no adónde redirige).
        redirect: 'manual',
      });
      if (!res.ok || !res.body) return null;
      const html = await this.leerConTope(res, MAX_HTML_BYTES);
      const m =
        html.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        ) ||
        html.match(
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        );
      return m?.[1] ?? null;
    } catch (error) {
      this.logger.debug(`Sin og:image para ${url}: ${String(error)}`);
      return null;
    }
  }

  /** Lee el body de a chunks y corta en maxBytes: res.text() bufearía la
   *  respuesta COMPLETA en memoria — una página de cientos de MB tumbaría
   *  el contenedor (mem_limit 512m) antes del slice. */
  private async leerConTope(res: Response, maxBytes: number): Promise<string> {
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let recibido = 0;
    while (recibido < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      recibido += value.byteLength;
    }
    void reader.cancel().catch(() => undefined);
    return Buffer.concat(chunks).toString('utf8').slice(0, maxBytes);
  }

  /** Solo http(s) hacia hosts que resuelven a IPs públicas. Rechaza
   *  loopback, RFC1918, link-local (169.254.x — metadata de cloud) y
   *  rangos internos de IPv6. */
  private async esUrlPublica(rawUrl: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    try {
      const ips = isIP(host)
        ? [{ address: host }]
        : await lookup(host, { all: true });
      return (
        ips.length > 0 && ips.every(({ address }) => this.esIpPublica(address))
      );
    } catch {
      return false; // no resuelve → no se fetchea
    }
  }

  private esIpPublica(ip: string): boolean {
    if (isIP(ip) === 4) {
      const [a, b] = ip.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127) return false; // this-net, privada, loopback
      if (a === 169 && b === 254) return false; // link-local / metadata cloud
      if (a === 172 && b >= 16 && b <= 31) return false; // privada
      if (a === 192 && b === 168) return false; // privada
      if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
      return true;
    }
    const v6 = ip.toLowerCase();
    if (v6 === '::' || v6 === '::1') return false; // unspecified, loopback
    if (v6.startsWith('fe80:')) return false; // link-local
    if (v6.startsWith('fc') || v6.startsWith('fd')) return false; // ULA
    if (v6.startsWith('::ffff:')) return this.esIpPublica(v6.slice(7)); // IPv4-mapeada
    return true;
  }
}
