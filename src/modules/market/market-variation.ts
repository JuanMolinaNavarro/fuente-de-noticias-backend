/**
 * Lógica pura de variación: sin Nest, sin Prisma, sin fechas "ahora"
 * implícitas. Recibe datos, devuelve datos. Eso la hace trivial de testear
 * y de razonar (misma idea que `domain/article-state.ts`).
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface Point {
  value: number;
  capturedAt: Date;
}

export interface Variation {
  /** Diferencia en la unidad del indicador (pesos o puntos). */
  absolute: number;
  /** Diferencia porcentual respecto de la referencia. */
  percent: number;
  /** Cuándo se capturó la medición contra la que comparamos. */
  referenceAt: Date;
}

/** Instante "hace 24 h" respecto de `now`. */
export function referenceCutoff(now: Date, windowMs = DAY_MS): Date {
  return new Date(now.getTime() - windowMs);
}

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/**
 * Variación de `current` contra `reference`. Devuelve null cuando no hay con
 * qué comparar (primer día de datos) o la referencia es 0 (división inválida):
 * preferimos "sin dato" a inventar un número.
 */
export function computeVariation(
  current: Point,
  reference: Point | null,
): Variation | null {
  if (!reference || reference.value === 0) return null;
  const absolute = current.value - reference.value;
  return {
    absolute: round(absolute, 2),
    percent: round((absolute / reference.value) * 100, 2),
    referenceAt: reference.capturedAt,
  };
}
