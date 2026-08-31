import { Injectable } from '@nestjs/common';
import type { MarketIndicator } from '@prisma/client';
import type { MarketSourcePort, Quote } from '../market.port';

const URL = 'https://dolarapi.com/v1/dolares';

/** Respuesta de DolarApi (solo los campos que usamos). */
interface DolarApiItem {
  casa: string;
  compra: number | null;
  venta: number | null;
  fechaActualizacion?: string;
}

/** Traducción "casa" de DolarApi → nuestro indicador. Lo que no está acá se ignora. */
const CASA_TO_INDICATOR: Record<string, MarketIndicator> = {
  oficial: 'DOLAR_OFICIAL',
  blue: 'DOLAR_BLUE',
  bolsa: 'DOLAR_MEP',
  contadoconliqui: 'DOLAR_CCL',
  mayorista: 'DOLAR_MAYORISTA',
  cripto: 'DOLAR_CRIPTO',
  tarjeta: 'DOLAR_TARJETA',
};

@Injectable()
export class DolarApiAdapter implements MarketSourcePort {
  readonly name = 'dolarapi';

  async fetchQuotes(): Promise<Quote[]> {
    const res = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`DolarApi respondió ${res.status}`);
    const items = (await res.json()) as DolarApiItem[];
    if (!Array.isArray(items)) {
      throw new Error('Respuesta de DolarApi con formato inesperado');
    }

    const quotes: Quote[] = [];
    for (const item of items) {
      const indicator = CASA_TO_INDICATOR[item.casa];
      // La venta es el valor principal; sin venta no hay cotización útil.
      if (!indicator || typeof item.venta !== 'number') continue;
      quotes.push({
        indicator,
        value: item.venta,
        buy: item.compra ?? null,
        sell: item.venta,
        sourceAt: parseDate(item.fechaActualizacion),
      });
    }
    if (quotes.length === 0) {
      throw new Error('DolarApi no devolvió ninguna cotización conocida');
    }
    return quotes;
  }
}

function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
