import { Injectable } from '@nestjs/common';
import type { MarketSourcePort, Quote } from '../market.port';

const URL =
  'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';

/** Respuesta: `{ "valor": 480, "fecha": "2026-08-14" }` */
interface RiesgoPaisResponse {
  valor?: number;
  fecha?: string;
}

/**
 * Riesgo país (EMBI+ de JP Morgan) vía ArgentinaDatos. Es un dato DIARIO:
 * la fuente publica un valor por rueda, así que `sourceAt` es una fecha sin
 * hora. La variación 24 h la calculamos igual sobre nuestras capturas.
 */
@Injectable()
export class ArgentinaDatosAdapter implements MarketSourcePort {
  readonly name = 'argentinadatos';

  async fetchQuotes(): Promise<Quote[]> {
    const res = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`ArgentinaDatos respondió ${res.status}`);
    const json = (await res.json()) as RiesgoPaisResponse;
    if (typeof json.valor !== 'number') {
      throw new Error('Respuesta de ArgentinaDatos sin valor de riesgo país');
    }
    return [
      {
        indicator: 'RIESGO_PAIS',
        value: json.valor,
        sourceAt: parseArgDate(json.fecha),
      },
    ];
  }
}

/** "YYYY-MM-DD" → medianoche de Argentina (UTC-3), no de UTC. */
function parseArgDate(raw?: string): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
