import { Injectable } from '@nestjs/common';
import type { MarketSourcePort, Quote } from '../market.port';

// ^MERV = S&P Merval. Pedimos 1 día para que la respuesta sea chica; solo
// usamos el `meta` (último precio + hora), no la serie.
const URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/%5EMERV?range=1d&interval=15m';

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketTime?: number };
    }>;
    error?: { description?: string } | null;
  };
}

/**
 * Merval vía el endpoint público (no documentado) de Yahoo Finance. No hay
 * API oficial gratuita del índice, así que aceptamos dos costos: mandar un
 * User-Agent de navegador y tolerar que algún día cambie. Si falla, el
 * service sigue sirviendo el último snapshot guardado.
 */
@Injectable()
export class YahooFinanceAdapter implements MarketSourcePort {
  readonly name = 'yahoo';

  async fetchQuotes(): Promise<Quote[]> {
    const res = await fetch(URL, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Yahoo Finance respondió ${res.status}`);
    const json = (await res.json()) as YahooChartResponse;
    if (json.chart?.error) {
      throw new Error(
        `Yahoo Finance devolvió error: ${json.chart.error.description ?? '?'}`,
      );
    }
    const meta = json.chart?.result?.[0]?.meta;
    if (typeof meta?.regularMarketPrice !== 'number') {
      throw new Error('Respuesta de Yahoo Finance sin precio del Merval');
    }
    return [
      {
        indicator: 'MERVAL',
        value: meta.regularMarketPrice,
        // regularMarketTime viene en segundos Unix
        sourceAt:
          typeof meta.regularMarketTime === 'number'
            ? new Date(meta.regularMarketTime * 1000)
            : null,
      },
    ];
  }
}
