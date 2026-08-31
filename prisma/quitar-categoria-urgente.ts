/**
 * Migración de DATOS: elimina la categoría "Urgente".
 *
 * La urgencia es un estado de la nota (Article.isBreaking + breakingUntil),
 * no una sección: tenerla también como Category permitía clasificar notas en
 * "Urgente" y dejarlas sin sección real. Este script:
 *  1. Desasigna (categoryId = null) las notas que la tenían — quedan
 *     "Sin categoría" para que la redacción las re-clasifique en el panel.
 *  2. Desvincula los feeds que apuntaban a ella.
 *  3. Borra la categoría.
 *
 * Idempotente: si la categoría ya no existe, no hace nada.
 * Uso: npx ts-node prisma/quitar-categoria-urgente.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const urgente = await prisma.category.findUnique({
    where: { slug: 'urgente' },
  });
  if (!urgente) {
    console.log('La categoría "Urgente" ya no existe. Nada que hacer.');
    return;
  }

  const notas = await prisma.article.findMany({
    where: { categoryId: urgente.id },
    select: { id: true, title: true, status: true, isBreaking: true },
  });
  for (const n of notas) {
    console.log(
      `Sin categoría queda: [${n.status}] "${n.title}"` +
        (n.isBreaking ? ' (sigue marcada Última hora)' : ''),
    );
  }

  const [notasRes, feedsRes] = await prisma.$transaction([
    prisma.article.updateMany({
      where: { categoryId: urgente.id },
      data: { categoryId: null },
    }),
    prisma.feed.updateMany({
      where: { categoryId: urgente.id },
      data: { categoryId: null },
    }),
    prisma.category.delete({ where: { id: urgente.id } }),
  ]);
  console.log(
    `Listo: ${notasRes.count} notas desasignadas, ${feedsRes.count} feeds desvinculados, categoría eliminada.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
