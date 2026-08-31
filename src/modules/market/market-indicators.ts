import { MarketIndicator } from '@prisma/client';

/**
 * Catálogo de indicadores: metadata de presentación que el frontend necesita
 * y que no cambia por request. Vive en el backend para que haya UNA fuente
 * de verdad de qué indicadores existen, en qué orden se muestran y cómo se
 * llaman; el frontend solo pinta.
 */
export type IndicatorKind = 'DOLAR' | 'INDEX' | 'RISK';

export interface IndicatorMeta {
  id: MarketIndicator;
  label: string;
  kind: IndicatorKind;
  /** 'ARS' para dólares (precio en pesos), 'points' para Merval y riesgo. */
  unit: 'ARS' | 'points';
}

export const INDICATORS: readonly IndicatorMeta[] = [
  { id: 'DOLAR_BLUE', label: 'Dólar blue', kind: 'DOLAR', unit: 'ARS' },
  { id: 'DOLAR_OFICIAL', label: 'Dólar oficial', kind: 'DOLAR', unit: 'ARS' },
  { id: 'DOLAR_TARJETA', label: 'Dólar tarjeta', kind: 'DOLAR', unit: 'ARS' },
  { id: 'DOLAR_CRIPTO', label: 'Dólar cripto', kind: 'DOLAR', unit: 'ARS' },
  { id: 'DOLAR_MEP', label: 'Dólar MEP', kind: 'DOLAR', unit: 'ARS' },
  { id: 'DOLAR_CCL', label: 'Dólar CCL', kind: 'DOLAR', unit: 'ARS' },
  {
    id: 'DOLAR_MAYORISTA',
    label: 'Dólar mayorista',
    kind: 'DOLAR',
    unit: 'ARS',
  },
  { id: 'MERVAL', label: 'S&P Merval', kind: 'INDEX', unit: 'points' },
  { id: 'RIESGO_PAIS', label: 'Riesgo país', kind: 'RISK', unit: 'points' },
];

export const ALL_INDICATORS: readonly MarketIndicator[] = INDICATORS.map(
  (i) => i.id,
);
