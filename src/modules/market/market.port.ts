import type { MarketIndicator } from '@prisma/client';

/**
 * Puerto: lo mínimo que el módulo necesita de "una fuente de mercado".
 * Cada fuente externa (DolarApi, ArgentinaDatos, Yahoo) es un adaptador que
 * cumple este contrato y devuelve una o más cotizaciones normalizadas.
 * El service no sabe ni le importa de dónde salen.
 */
export interface Quote {
  indicator: MarketIndicator;
  /** Valor principal: venta en dólares, puntos en índices. */
  value: number;
  buy?: number | null;
  sell?: number | null;
  /** Fecha del dato según la fuente (null si no la informa). */
  sourceAt?: Date | null;
}

export interface MarketSourcePort {
  /** Nombre corto que queda guardado en `MarketSnapshot.source`. */
  readonly name: string;
  fetchQuotes(): Promise<Quote[]>;
}

/**
 * Token de inyección. A diferencia del clima (UN proveedor), acá hay VARIOS
 * proveedores a la vez, así que el token resuelve a un array de puertos.
 */
export const MARKET_SOURCES = Symbol('MARKET_SOURCES');
