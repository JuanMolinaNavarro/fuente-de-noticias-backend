/**
 * Similaridad entre la nota publicada y el material de la fuente — dominio puro.
 *
 * Objetivo editorial/legal: una nota "curada" a partir de un feed ajeno tiene
 * que estar redactada con palabras propias; reproducir el texto de la fuente
 * (aunque se lo atribuya) es riesgo de copyright. Este medidor responde la
 * pregunta concreta: "¿qué fracción de las frases de MI nota aparece textual
 * en la fuente?".
 *
 * Algoritmo: shingles (n-gramas) de K palabras sobre texto normalizado y
 *   containment = |S(nota) ∩ S(fuente)| / |S(nota)|
 *
 * Por qué containment y no Jaccard: la fuente suele ser mucho más larga que la
 * nota (8 000 vs. 1 500 caracteres). Jaccard divide por la unión, que está
 * dominada por la fuente, y nunca llegaría al umbral aunque la nota fuera una
 * copia literal. Containment normaliza por el tamaño de la nota, que es lo que
 * nos importa. K=5 palabras: frases de 5 palabras iguales rara vez son
 * casualidad; con 3 habría demasiados falsos positivos por giros comunes.
 *
 * O(n) en memoria y tiempo, sin IA: se puede recalcular en cada guardado.
 */

export const DEFAULT_SHINGLE_SIZE = 5;

/** minúsculas, sin tildes, sin puntuación, espacios colapsados */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shingles(text: string, k = DEFAULT_SHINGLE_SIZE): Set<string> {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + k <= words.length; i++) {
    out.add(words.slice(i, i + k).join(' '));
  }
  return out;
}

/**
 * Fracción [0, 1] de los n-gramas de `note` que aparecen en `source`.
 * Si la nota es tan corta que no tiene ni un n-grama, devuelve 0.
 */
export function containment(
  note: string,
  source: string,
  k = DEFAULT_SHINGLE_SIZE,
): number {
  const a = shingles(note, k);
  if (a.size === 0) return 0;
  const b = shingles(source, k);
  let hits = 0;
  for (const s of a) if (b.has(s)) hits++;
  return hits / a.size;
}
