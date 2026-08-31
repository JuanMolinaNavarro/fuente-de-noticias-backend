import { containment, normalizeText, shingles } from './similarity';

const FUENTE =
  'El Banco Central resolvió este jueves una baja de la tasa de política monetaria del 35% al 32% anual, en línea con la desaceleración de la inflación de los últimos tres meses. La decisión fue anunciada tras la reunión de directorio.';

describe('normalizeText', () => {
  it('minúsculas, sin tildes ni puntuación, espacios colapsados', () => {
    expect(normalizeText('  ¡Economía  en ACCIÓN!  ')).toBe(
      'economia en accion',
    );
  });
});

describe('shingles', () => {
  it('genera n-gramas de 5 palabras solapados', () => {
    const s = shingles('a b c d e f', 5);
    expect([...s]).toEqual(['a b c d e', 'b c d e f']);
  });
  it('texto más corto que k no tiene n-gramas', () => {
    expect(shingles('a b c', 5).size).toBe(0);
  });
});

describe('containment', () => {
  it('copia literal ≈ 1', () => {
    expect(containment(FUENTE, FUENTE)).toBe(1);
  });

  it('texto totalmente distinto ≈ 0', () => {
    const propia =
      'La selección juvenil venció dos a cero y aseguró su clasificación a la copa del mundo de la categoría, que se disputará el año próximo en otro continente.';
    expect(containment(propia, FUENTE)).toBe(0);
  });

  it('una nota reescrita que cita una frase entera queda en el medio', () => {
    const mezcla =
      'El Central bajó la tasa y consolida el ciclo de recortes. Según el comunicado, la baja de la tasa de política monetaria del 35% al 32% anual responde a la menor inflación. Analistas esperaban el movimiento.';
    const c = containment(mezcla, FUENTE);
    expect(c).toBeGreaterThan(0.1);
    expect(c).toBeLessThan(0.6);
  });

  it('nota vacía o muy corta -> 0 (no bloquea)', () => {
    expect(containment('', FUENTE)).toBe(0);
    expect(containment('hola que tal', FUENTE)).toBe(0);
  });

  it('es insensible a mayúsculas, tildes y puntuación', () => {
    expect(containment(FUENTE.toUpperCase().replace(/,/g, ''), FUENTE)).toBe(1);
  });
});
