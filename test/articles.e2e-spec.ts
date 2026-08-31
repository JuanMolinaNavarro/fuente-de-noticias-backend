import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  articleData,
  createCategory,
  createTestApp,
  getPrisma,
  truncateAll,
} from './utils';

describe('Articles público (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);

    const economia = await createCategory(prisma, 'Economía');
    const deportes = await createCategory(prisma, 'Deportes');

    const rows = [
      articleData({
        title: 'Nota de economía',
        summary: 'Bajada economía',
        content: 'Cuerpo economía',
        categoryId: economia.id,
        slug: 'nota-economia',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-08-14T10:00:00Z'),
      }),
      articleData({
        title: 'Otra de economía',
        content: 'Cuerpo',
        categoryId: economia.id,
        slug: 'otra-economia',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-08-14T09:00:00Z'),
      }),
      articleData({
        title: 'Nota de deportes',
        content: 'Cuerpo deportes',
        categoryId: deportes.id,
        slug: 'nota-deportes',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-08-14T08:00:00Z'),
      }),
      articleData({
        title: 'Borrador oculto',
        content: 'No debería verse',
        slug: 'borrador-oculto',
        status: 'DRAFT',
      }),
    ];
    // createMany no admite relaciones anidadas (source): creamos de a una
    for (const data of rows) await prisma.article.create({ data });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('lista solo PUBLISHED, ordenado por publishedAt desc, con meta de paginación', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/articles')
      .expect(200);

    expect(res.body.meta).toEqual({
      page: 1,
      limit: 19,
      total: 3,
      totalPages: 1,
    });
    expect(res.body.data.map((a: { slug: string }) => a.slug)).toEqual([
      'nota-economia',
      'otra-economia',
      'nota-deportes',
    ]);
  });

  it('no filtra campos internos al público (DTO ≠ entidad)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/articles')
      .expect(200);

    const first = res.body.data[0] as Record<string, unknown>;
    for (const campoInterno of [
      'guid',
      'feedUrl',
      'originalTitle',
      'originalContent',
      'originalImageUrl',
      'status',
      'reviewedById',
      'sourceSimilarity',
      'source',
      'createdById',
    ]) {
      expect(first).not.toHaveProperty(campoInterno);
    }
    // pero sí expone la sección por nombre y la fuente por nombre
    expect(first.category).toBe('Economía');
    expect(first.categorySlug).toBe('economia');
    expect(first.sourceName).toBe('Fuente E2E');
  });

  it('filtra por categoría, por nombre o por slug', async () => {
    const porNombre = await request(app.getHttpServer())
      .get('/api/v1/articles?category=Economía')
      .expect(200);
    expect(porNombre.body.meta.total).toBe(2);
    const porSlug = await request(app.getHttpServer())
      .get('/api/v1/articles?category=deportes')
      .expect(200);
    expect(porSlug.body.meta.total).toBe(1);
  });

  it('pagina con page/limit', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/articles?limit=1&page=2')
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('otra-economia');
    expect(res.body.meta.totalPages).toBe(3);
  });

  it('rechaza query inválida (validación en el borde)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/articles?page=0')
      .expect(400);
  });

  it('devuelve el detalle con contenido y atribución', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/articles/nota-economia')
      .expect(200);
    expect(res.body.content).toBe('Cuerpo economía');
    expect(res.body.sourceUrl).toBe('https://example.com/original');
    expect(res.body.origin).toBe('FEED');
  });

  it('un DRAFT con slug devuelve 404 (para el público no existe)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/articles/borrador-oculto')
      .expect(404);
  });

  it('slug inexistente devuelve 404', () => {
    return request(app.getHttpServer())
      .get('/api/v1/articles/no-existe')
      .expect(404);
  });

  it('relacionadas: misma categoría, excluye la actual', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/articles/nota-economia/related')
      .expect(200);
    expect(res.body.map((a: { slug: string }) => a.slug)).toEqual([
      'otra-economia',
    ]);
  });
});
