/**
 * Datos de PRUEBA de mercado — solo desarrollo.
 *
 * El módulo market calcula la variación contra la captura de hace 24 h, así
 * que en una base recién creada no hay variación hasta el día siguiente. Este
 * script fabrica 25 h de historia sintética por indicador (una captura por
 * hora) para poder ver variaciones y mini-gráficos ya mismo.
 *
 * - Ancla cada serie en el último snapshot REAL que exista (para que los
 *   números sean verosímiles) y aplica una variación objetivo distinta por
 *   indicador, así hay subas, bajas y una sin cambios.
 * - Marca todo con source = 'seed-dev': se distingue de los datos reales y
 *   se puede borrar sin tocar nada más.
 * - Idempotente: cada corrida borra la anterior antes de generar.
 *
 * Uso: npm run market:seed-dev             (regenera)
 *      npm run market:seed-dev -- --clean  (solo borra)
 */
import { MarketIndicator, Prisma, PrismaClient } from '@prisma/client';

// Guarda: estos datos sintéticos se mezclarían con los reales en
// /market/summary (nada filtra source='seed-dev' en las lecturas).
// En producción este script no debe correr jamás.
if (process.env.NODE_ENV === 'production') {
  console.error(
    'seed-market-dev genera datos FICTICIOS y NODE_ENV=production. Abortado.',
  );
  process.exit(1);
}

const prisma = new PrismaClient();
const SOURCE = 'seed-dev';
const HOURS = 25;

/** Variación objetivo (%) entre hace 24 h y el valor actual, por indicador. */
const TARGET_PCT: Record<MarketIndicator, number> = {
  DOLAR_BLUE: 0.3,
  DOLAR_OFICIAL: -0.2,
  DOLAR_TARJETA: -0.3,
  DOLAR_CRIPTO: 0.6,
  DOLAR_MEP: -0.4,
  DOLAR_CCL: -0.6,
  DOLAR_MAYORISTA: 0, // sin cambios: prueba el estado neutro
  MERVAL: 1.8,
  RIESGO_PAIS: -2.5,
};

/** Por si la tabla está vacía y no hay snapshot real para anclar. */
const FALLBACK: Record<MarketIndicator, { value: number; spread: number }> = {
  DOLAR_BLUE: { value: 1545, spread: 20 },
  DOLAR_OFICIAL: { value: 1510, spread: 50 },
  DOLAR_TARJETA: { value: 1963, spread: 65 },
  DOLAR_CRIPTO: { value: 1580, spread: 4 },
  DOLAR_MEP: { value: 1521, spread: 12 },
  DOLAR_CCL: { value: 1573, spread: 3 },
  DOLAR_MAYORISTA: { value: 1487, spread: 9 },
  MERVAL: { value: 2_950_000, spread: 0 },
  RIESGO_PAIS: { value: 480, spread: 0 },
};

/** Ruido determinístico (LCG) para que la curva tenga forma pero sea repetible. */
function makeNoise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5; // [-0.5, 0.5)
  };
}

async function clean() {
  const { count } = await prisma.marketSnapshot.deleteMany({
    where: { source: SOURCE },
  });
  console.log(`Borrados ${count} snapshots de prueba.`);
}

async function seed() {
  await clean();
  const now = Date.now();
  const rows: Prisma.MarketSnapshotCreateManyInput[] = [];

  for (const indicator of Object.keys(TARGET_PCT) as MarketIndicator[]) {
    const real = await prisma.marketSnapshot.findFirst({
      where: { indicator, NOT: { source: SOURCE } },
      orderBy: { capturedAt: 'desc' },
    });
    const anchor = real?.value ?? FALLBACK[indicator].value;
    const spread =
      real && real.buy != null && real.sell != null
        ? real.sell - real.buy
        : FALLBACK[indicator].spread;
    const isDollar = indicator.startsWith('DOLAR_');

    // Valor de hace 24 h tal que (anchor - ref) / ref = objetivo
    const ref = anchor / (1 + TARGET_PCT[indicator] / 100);
    const noise = makeNoise(indicator.length * 7919);
    const amplitude = Math.abs(anchor - ref) * 0.6 || anchor * 0.001;

    // Una captura por hora, de -25 h a -1 h; interpolamos ref → anchor con ruido.
    for (let h = HOURS; h >= 1; h--) {
      const progress = (HOURS - h) / (HOURS - 1); // 0 en -25 h, 1 en -1 h
      const base = ref + (anchor - ref) * progress;
      const wobble = h === HOURS - 1 ? 0 : noise() * amplitude; // -24 h exacta sin ruido
      const value = round(base + wobble, isDollar ? 2 : 1);
      rows.push({
        indicator,
        value,
        sell: isDollar ? value : null,
        buy: isDollar ? round(value - spread, 2) : null,
        source: SOURCE,
        sourceAt: null,
        capturedAt: new Date(now - h * 60 * 60 * 1000),
      });
    }
  }

  await prisma.marketSnapshot.createMany({ data: rows });
  console.log(
    `Generados ${rows.length} snapshots de prueba (${HOURS} h × ${Object.keys(TARGET_PCT).length} indicadores).`,
  );
  console.log(
    'El resumen se cachea 60 s en el backend: esperá un minuto o pegale a POST /admin/market/refresh.',
  );
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

const onlyClean = process.argv.includes('--clean');
(onlyClean ? clean() : seed())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
