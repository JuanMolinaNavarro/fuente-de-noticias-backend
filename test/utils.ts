import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

export function getPrisma(app: INestApplication<App>): PrismaService {
  return app.get(PrismaService);
}

/**
 * Deja la base de test vacía. Lee las tablas del schema `public` en vez de
 * mantener una lista a mano: con cada modelo nuevo la lista quedaba vieja y
 * los e2e fallaban por FKs colgadas. `_prisma_migrations` se preserva.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
  );
}

export async function createUser(
  prisma: PrismaService,
  data: { email: string; password: string; role?: Role; name?: string },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 4), // pocas rondas: tests rápidos
      name: data.name ?? 'Test User',
      role: data.role ?? 'EDITOR',
    },
  });
}

/** Crea el usuario y devuelve su token de acceso. */
export async function loginAs(
  app: INestApplication<App>,
  prisma: PrismaService,
  data: { email: string; password?: string; role?: Role; name?: string },
) {
  const password = data.password ?? 'clave-segura';
  const user = await createUser(prisma, { ...data, password });
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: data.email, password });
  return { user, token: res.body.accessToken as string };
}

export function createCategory(
  prisma: PrismaService,
  name: string,
  slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''),
) {
  return prisma.category.upsert({
    where: { slug },
    update: {},
    create: { name, slug, color: '#123456' },
  });
}

/** Material de feed mínimo válido, con overrides. */
export function sourceData(
  overrides: Partial<Prisma.ArticleSourceCreateWithoutArticleInput> = {},
) {
  return {
    guid: `e2e-${Math.random().toString(36).slice(2)}`,
    feedUrl: 'e2e',
    sourceName: 'Fuente E2E',
    sourceUrl: 'https://example.com/original',
    originalTitle: 'Título original del feed',
    originalContent: 'Contenido original del feed',
    ...overrides,
  };
}

/**
 * Artículo de FEED mínimo válido (con su ArticleSource anidada), con overrides
 * sobre el artículo. Para el material del feed usar `source`.
 */
export function articleData(
  overrides: Partial<Prisma.ArticleUncheckedCreateInput> = {},
  source: Partial<Prisma.ArticleSourceCreateWithoutArticleInput> = {},
): Prisma.ArticleUncheckedCreateInput {
  return {
    origin: 'FEED',
    status: 'DRAFT',
    source: { create: sourceData(source) },
    ...overrides,
  };
}
