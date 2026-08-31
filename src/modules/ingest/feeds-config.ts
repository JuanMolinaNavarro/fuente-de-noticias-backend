/**
 * Parsea RSS_FEEDS: entradas "url" o "url|Categoría" separadas por coma.
 * Función pura — en la Fase 3 esto se reemplaza por la tabla Feed.
 */
export interface FeedConfig {
  url: string;
  category: string | null;
}

export function parseFeedsConfig(raw: string | undefined): FeedConfig[] {
  return (raw ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((entrada) => {
      const [url, categoria] = entrada.split('|').map((s) => s.trim());
      return { url, category: categoria || null };
    });
}
