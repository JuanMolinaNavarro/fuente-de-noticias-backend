/**
 * Migración de DATOS: genera Article.contentJson (documento ProseMirror) a
 * partir del texto plano heredado en Article.content, y calcula la
 * similaridad con la fuente para las notas de feed.
 *
 * Va como script y no dentro de la migración SQL porque la conversión es
 * lógica de aplicación (src/domain/content.ts) y queremos una sola
 * implementación de "texto plano -> doc", no una copia en SQL.
 *
 * Idempotente: sólo toca filas con contentJson NULL. Procesa en lotes.
 * Uso: npx ts-node prisma/backfill-content-json.ts
 */
import { PrismaClient } from '@prisma/client';
import { plainTextToDoc } from '../src/domain/content';
import { containment } from '../src/domain/similarity';

const prisma = new PrismaClient();
const LOTE = 100;

async function main() {
  let convertidos = 0;
  for (;;) {
    // Prisma no tiene un filtro portable para "columna JSON IS NULL":
    // los ids salen por SQL crudo y el resto va con el cliente tipado.
    const ids = (
      await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Article"
        WHERE "contentJson" IS NULL AND "content" IS NOT NULL
        LIMIT ${LOTE}`
    ).map((r) => r.id);
    if (ids.length === 0) break;

    const filas = await prisma.article.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        content: true,
        origin: true,
        source: { select: { originalContent: true } },
      },
    });

    for (const a of filas) {
      const content = a.content ?? '';
      await prisma.article.update({
        where: { id: a.id },
        data: {
          contentJson: plainTextToDoc(content),
          sourceSimilarity:
            a.origin === 'FEED' && a.source
              ? containment(content, a.source.originalContent)
              : null,
        },
      });
      convertidos++;
    }
    console.log(`... ${convertidos} convertidos`);
  }
  console.log(`Listo: ${convertidos} artículos con contentJson.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
