import { computeVariation, DAY_MS, referenceCutoff } from './market-variation';

const at = (iso: string) => new Date(iso);

describe('referenceCutoff', () => {
  it('devuelve exactamente 24 h antes por defecto', () => {
    const now = at('2026-08-18T12:00:00Z');
    expect(referenceCutoff(now).toISOString()).toBe('2026-08-17T12:00:00.000Z');
    expect(now.getTime() - referenceCutoff(now).getTime()).toBe(DAY_MS);
  });
});

describe('computeVariation', () => {
  const current = { value: 1545, capturedAt: at('2026-08-18T12:00:00Z') };

  it('calcula suba en absoluto y porcentaje', () => {
    const reference = { value: 1540, capturedAt: at('2026-08-17T12:00:00Z') };
    expect(computeVariation(current, reference)).toEqual({
      absolute: 5,
      percent: 0.32, // 5 / 1540 = 0.3246…% → redondeado a 2 decimales
      referenceAt: reference.capturedAt,
    });
  });

  it('calcula baja con signo negativo', () => {
    const reference = { value: 1550, capturedAt: at('2026-08-17T12:00:00Z') };
    const v = computeVariation(current, reference);
    expect(v?.absolute).toBe(-5);
    expect(v?.percent).toBe(-0.32);
  });

  it('da 0 cuando el valor no cambió (fin de semana)', () => {
    const reference = { value: 1545, capturedAt: at('2026-08-17T12:00:00Z') };
    expect(computeVariation(current, reference)).toEqual({
      absolute: 0,
      percent: 0,
      referenceAt: reference.capturedAt,
    });
  });

  it('devuelve null sin referencia (primer día de datos)', () => {
    expect(computeVariation(current, null)).toBeNull();
  });

  it('devuelve null si la referencia es 0 (evita dividir por cero)', () => {
    const reference = { value: 0, capturedAt: at('2026-08-17T12:00:00Z') };
    expect(computeVariation(current, reference)).toBeNull();
  });

  it('redondea el absoluto a 2 decimales (Merval tiene decimales largos)', () => {
    const merval = { value: 2947349.2, capturedAt: current.capturedAt };
    const ref = { value: 3000582.2, capturedAt: at('2026-08-17T12:00:00Z') };
    const v = computeVariation(merval, ref);
    expect(v?.absolute).toBe(-53233);
    expect(v?.percent).toBe(-1.77);
  });
});
