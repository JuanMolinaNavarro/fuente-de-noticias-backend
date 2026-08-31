/**
 * Seed de la base:
 *  - Crea el usuario admin inicial desde SEED_ADMIN_EMAIL/PASSWORD, SOLO si
 *    no existe. Nunca toca una cuenta ya creada: si el admin cambió su
 *    contraseña (o fue desactivado) desde el panel, un redeploy no lo revierte.
 *  - Con el flag --demo carga además un editor y un redactor de prueba y
 *    3 artículos de demostración (2 de feed, 1 original).
 *
 * Uso: npx prisma db seed            (solo admin)
 *      npx prisma db seed -- --demo  (admin + usuarios + artículos demo)
 *
 * Es idempotente: correrlo dos veces no duplica nada (create-if-missing /
 * delete previo).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { plainTextToDoc } from '../src/domain/content';

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log(
      'SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD no definidos: se omite el admin.',
    );
    return null;
  }

  // Create-if-missing, NUNCA upsert: un upsert con update de passwordHash
  // restauraría la contraseña del seed (y reactivaría la cuenta) en cada
  // deploy, deshaciendo cambios hechos desde el panel. Hallazgo A-1 de la
  // auditoría de seguridad (2026-08).
  const existente = await prisma.user.findUnique({ where: { email } });
  if (existente) {
    console.log(`Usuario admin ya existe (${email}): no se modifica.`);
    return existente;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: { email, passwordHash, name: 'Admin', role: 'ADMIN' },
  });
  console.log(`Usuario admin creado: ${email}`);
  return admin;
}

/** Usuarios de prueba, uno por rol (contraseña = 'demo_2026' para ambos). */
async function seedDemoUsers() {
  const passwordHash = await bcrypt.hash('demo_2026', 10);
  const editor = await prisma.user.upsert({
    where: { email: 'editor@fuentedenoticias.com.ar' },
    update: { passwordHash, role: 'EDITOR', isActive: true },
    create: {
      email: 'editor@fuentedenoticias.com.ar',
      passwordHash,
      name: 'Elena Editora',
      role: 'EDITOR',
    },
  });
  const redactor = await prisma.user.upsert({
    where: { email: 'redactor@fuentedenoticias.com.ar' },
    update: { passwordHash, role: 'REDACTOR', isActive: true },
    create: {
      email: 'redactor@fuentedenoticias.com.ar',
      passwordHash,
      name: 'Ramiro Redactor',
      role: 'REDACTOR',
    },
  });
  console.log('Usuarios demo listos: editor@ y redactor@ (clave demo_2026)');
  return { editor, redactor };
}

const demoFeed = [
  {
    source: {
      guid: 'demo-1',
      feedUrl: 'demo',
      sourceName: 'Diario Ejemplo',
      sourceUrl: 'https://example.com/nota-1',
      originalTitle:
        'El Banco Central redujo la tasa de interés de referencia al 32%',
      originalContent:
        'El directorio del Banco Central resolvió este jueves una baja de la tasa de política monetaria del 35% al 32% anual, en línea con la desaceleración de la inflación de los últimos tres meses...',
      originalImageUrl: null,
    },
    kicker: 'Política monetaria',
    title: 'El Central bajó la tasa al 32% y consolida el ciclo de recortes',
    summary:
      'Es la tercera reducción consecutiva de la tasa de referencia, apoyada en la desaceleración de la inflación del último trimestre.',
    content:
      'El Banco Central resolvió recortar la tasa de política monetaria del 35% al 32% anual, en lo que constituye la tercera baja consecutiva del año.\n\nLa decisión se apoya en la desaceleración que viene mostrando la inflación durante el último trimestre, y busca abaratar el crédito para empresas y familias sin comprometer el ancla monetaria.\n\nAnalistas del mercado esperaban un recorte de esta magnitud, aunque advierten que el margen para nuevas bajas dependerá de los próximos datos de precios.\n\nLa información fue publicada originalmente por Diario Ejemplo.',
    categorySlug: 'economia',
    slug: 'el-central-bajo-la-tasa-al-32-demo',
    status: 'PUBLISHED' as const,
    publishedAt: new Date(),
  },
  {
    source: {
      guid: 'demo-2',
      feedUrl: 'demo',
      sourceName: 'Agencia Demo',
      sourceUrl: 'https://example.com/nota-2',
      originalTitle:
        'Científicos argentinos desarrollan un trigo resistente a la sequía',
      originalContent:
        'Un equipo del CONICET y una empresa de biotecnología presentaron una variedad de trigo modificado genéticamente que tolera períodos prolongados de estrés hídrico...',
      originalImageUrl: null,
    },
    kicker: 'Ciencia',
    title: 'Presentan un trigo argentino que tolera la sequía',
    summary:
      'El desarrollo del CONICET junto a una empresa biotecnológica promete rendimientos estables en campañas con déficit hídrico.',
    content:
      'Un equipo del CONICET, en conjunto con una empresa de biotecnología local, presentó una variedad de trigo capaz de mantener el rendimiento en períodos prolongados de sequía.\n\nEl desarrollo, que llevó más de una década de investigación, ya superó las instancias regulatorias locales y apunta a las campañas del próximo año.\n\nLa información fue publicada originalmente por Agencia Demo.',
    categorySlug: 'tecnologia',
    slug: 'trigo-argentino-tolerante-sequia-demo',
    status: 'PUBLISHED' as const,
    publishedAt: new Date(Date.now() - 3600_000),
  },
];

const demoOriginal = {
  kicker: 'Fútbol juvenil',
  title: 'La selección juvenil sacó pasaje al mundial',
  summary:
    'Con un 2-0 sólido, el equipo aseguró su lugar en la cita mundialista del año próximo.',
  content:
    'La selección juvenil venció 2 a 0 y aseguró su clasificación a la copa del mundo de la categoría, que se disputará el año próximo.\n\nEl equipo cerró la fase clasificatoria invicto como local y con la valla menos vencida del torneo.',
  categorySlug: 'deportes',
};

async function seedDemo(redactorId: string) {
  // Limpieza previa (idempotencia): borrar las demo por guid y por título
  await prisma.article.deleteMany({
    where: {
      OR: [
        { source: { guid: { startsWith: 'demo-' } } },
        { origin: 'ORIGINAL', title: demoOriginal.title },
      ],
    },
  });

  const cats = await prisma.category.findMany();
  const idPorSlug = new Map(cats.map((c) => [c.slug, c.id]));

  for (const d of demoFeed) {
    const { source, categorySlug, ...rest } = d;
    await prisma.article.create({
      data: {
        ...rest,
        origin: 'FEED',
        contentJson: plainTextToDoc(rest.content),
        firstPublishedAt: rest.publishedAt,
        categoryId: idPorSlug.get(categorySlug) ?? null,
        source: { create: source },
      },
    });
  }
  const { categorySlug, ...orig } = demoOriginal;
  await prisma.article.create({
    data: {
      ...orig,
      origin: 'ORIGINAL',
      status: 'DRAFT',
      contentJson: plainTextToDoc(orig.content),
      categoryId: idPorSlug.get(categorySlug) ?? null,
      createdById: redactorId,
      lastEditedById: redactorId,
      authors: { create: [{ userId: redactorId, order: 0 }] },
    },
  });
  console.log(`Se cargaron ${demoFeed.length + 1} artículos de demostración.`);
}

async function main() {
  await seedAdmin();
  if (process.argv.includes('--demo')) {
    const { redactor } = await seedDemoUsers();
    await seedDemo(redactor.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
