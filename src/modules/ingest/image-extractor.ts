import { Injectable, Logger } from '@nestjs/common';
import type { FeedItem } from './feed-parser.adapter';

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
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (FuenteDeNoticias ingestor)' },
      });
      if (!res.ok) return null;
      const html = (await res.text()).slice(0, 200_000);
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
}
