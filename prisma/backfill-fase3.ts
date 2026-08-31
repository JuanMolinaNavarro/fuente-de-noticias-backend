/**
 * Migración de DATOS de la Fase 3 (la migración de SCHEMA ya la hizo Prisma):
 *  1. Inserta las categorías de marca (antes hardcodeadas en el frontend).
 *  2. Inserta los feeds desde RSS_FEEDS (antes una env var), vinculados a
 *     su categoría fija.
 *  3. Backfillea Article.categoryId matcheando el viejo string libre.
 *
 * Idempotente: se puede correr las veces que haga falta.
 * Uso: npx ts-node prisma/backfill-fase3.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Colores del Manual de Identidad (sección 01). inNav replica SECCIONES_NAV.
const CATEGORIAS: {
  name: string;
  slug: string;
  color: string;
  order: number;
  inNav: boolean;
}[] = [
  { name: 'Tucumán', slug: 'tucuman', color: '#1C3A6B', order: 1, inNav: true },
  { name: 'Política', slug: 'politica', color: '#C0392B', order: 2, inNav: true },
  { name: 'Policial', slug: 'policial', color: '#2C3E50', order: 3, inNav: true },
  { name: 'Economía', slug: 'economia', color: '#1A7A4A', order: 4, inNav: true },
  { name: 'Deportes', slug: 'deportes', color: '#E67E22', order: 5, inNav: true },
  { name: 'Cultura', slug: 'cultura', color: '#7B2FBE', order: 6, inNav: true },
  { name: 'Internacional', slug: 'internacional', color: '#12707E', order: 7, inNav: false },
  { name: 'Sociedad', slug: 'sociedad', color: '#B7791F', order: 8, inNav: false },
  { name: 'Campo', slug: 'campo', color: '#8B5E3C', order: 9, inNav: false },
  { name: 'Tecnología', slug: 'tecnologia', color: '#0E9CB8', order: 10, inNav: false },
  // "Urgente" no es una categoría: es el flag isBreaking de la nota
  // (ver prisma/quitar-categoria-urgente.ts, que la eliminó de la base).
];

function parseFeeds(raw: string | undefined) {
  return (raw ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((entrada) => {
      const [url, categoria] = entrada.split('|').map((s) => s.trim());
      return { url, categoryName: categoria || null };
    });
}

async function main() {
  // 1. Categorías
  for (const c of CATEGORIAS) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, color: c.color, order: c.order, inNav: c.inNav },
      create: c,
    });
  }
  console.log(`${CATEGORIAS.length} categorías listas.`);

  // 2. Feeds desde la env var
  const feeds = parseFeeds(process.env.RSS_FEEDS);
  for (const f of feeds) {
    const category = f.categoryName
      ? await prisma.category.findUnique({ where: { name: f.categoryName } })
      : null;
    await prisma.feed.upsert({
      where: { url: f.url },
      update: { categoryId: category?.id ?? null },
      create: { url: f.url, categoryId: category?.id ?? null },
    });
  }
  console.log(`${feeds.length} feeds listos.`);

  // 3. (Histórico) El backfill de Article.categoryId desde el string libre
  //    pasó a la migración drop_legacy_category_string; la columna ya no existe.
  const sinCategoria = await prisma.article.count({
    where: { categoryId: null },
  });
  console.log(`Artículos sin categoría: ${sinCategoria}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
