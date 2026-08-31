/**
 * Migración de DATOS: antes de la Fase 0 la ingesta copiaba la imagen del
 * feed a Article.imageUrl y se publicaba tal cual (copyright de terceros).
 * Este script pone en NULL toda imageUrl que sea exactamente la imagen del
 * feed (source.originalImageUrl); las URLs cargadas a mano por un editor
 * (distintas de la del feed) se respetan. Desde ahora la vía es la
 * biblioteca de medios (featuredMediaId).
 *
 * Idempotente. Uso: npx ts-node prisma/limpiar-imagenes-feed.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dry = process.argv.includes('--dry-run');

async function main() {
  const candidatas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a."id" FROM "Article" a
    JOIN "ArticleSource" s ON s."articleId" = a."id"
    WHERE a."imageUrl" IS NOT NULL AND a."imageUrl" = s."originalImageUrl"`;
  console.log(`${candidatas.length} notas con la imagen del feed como destacada.`);
  if (dry || candidatas.length === 0) return;
  const r = await prisma.article.updateMany({
    where: { id: { in: candidatas.map((c) => c.id) } },
    data: { imageUrl: null },
  });
  console.log(`Limpiadas: ${r.count}. La portada mostrará la placa de sección hasta que elijan una propia.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
