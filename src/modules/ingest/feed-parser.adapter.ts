import { Injectable } from '@nestjs/common';
import Parser from 'rss-parser';

/** Item del feed ya normalizado: lo único que el pipeline necesita saber. */
export interface FeedItem {
  guid: string;
  title: string;
  link: string;
  categories: string[];
  contentHtml: string;
  enclosureImage: string | null;
  mediaImage: string | null;
}

export interface ParsedFeed {
  sourceName: string;
  items: FeedItem[];
}

type RawItem = Parser.Item & {
  mediaContent?: { $?: { url?: string } }[];
  mediaThumbnail?: { $?: { url?: string } }[];
  'content:encoded'?: string;
};

/**
 * Un <category domain="...">Texto</category> no llega como string sino como
 * objeto { _: 'Texto', $: {...} } y encima sin prototipo (xml2js), así que
 * ni siquiera tiene toString(). Acá se normaliza todo a string plano.
 */
function normalizarCategorias(crudas: unknown[] | undefined): string[] {
  return (crudas ?? [])
    .map((c) => (typeof c === 'string' ? c : (c as { _?: unknown })?._))
    .filter((c): c is string => typeof c === 'string');
}

/**
 * Adaptador sobre rss-parser: traduce el formato crudo del feed (con sus
 * rarezas: media:content, enclosures, content:encoded) al FeedItem propio.
 * Si mañana cambia la librería, solo cambia este archivo.
 */
@Injectable()
export class FeedParserAdapter {
  private readonly parser: Parser<object, RawItem> = new Parser({
    timeout: 30_000,
    headers: { 'User-Agent': 'Mozilla/5.0 (FuenteDeNoticias ingestor)' },
    customFields: {
      item: [
        ['media:content', 'mediaContent', { keepArray: true }],
        ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ],
    },
  });

  async parse(feedUrl: string): Promise<ParsedFeed> {
    const feed = await this.parser.parseURL(feedUrl);
    const sourceName = feed.title ?? new URL(feedUrl).hostname;

    const items: FeedItem[] = [];
    for (const item of feed.items ?? []) {
      const guid = item.guid || item.link;
      if (!guid || !item.title || !item.link) continue;

      const enclosure =
        item.enclosure?.url &&
        (item.enclosure.type ?? 'image').includes('image')
          ? item.enclosure.url
          : null;
      const media =
        item.mediaContent?.[0]?.$?.url ??
        item.mediaThumbnail?.[0]?.$?.url ??
        null;

      items.push({
        guid,
        title: item.title,
        link: item.link,
        categories: normalizarCategorias(item.categories),
        contentHtml:
          item['content:encoded'] || item.content || item.contentSnippet || '',
        enclosureImage: enclosure,
        mediaImage: media,
      });
    }
    return { sourceName, items };
  }
}
