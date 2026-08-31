import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  articleData,
  createCategory,
  createTestApp,
  getPrisma,
  loginAs,
  truncateAll,
} from './utils';

/**
 * Flujo editorial básico sobre una nota de FEED (la que trae la ingesta):
 * editar → publicar → despublicar → republicar → descartar. Los casos de
 * roles, revisiones y notas originales están en admin-workflow y
 * admin-permissions.
 */
describe('Flujo editorial admin (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let draftId: string;
  let economiaId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);

    ({ token } = await loginAs(app, prisma, { email: 'editor@test.com' }));
    economiaId = (await createCategory(prisma, 'Economía')).id;

    const draft = await prisma.article.create({
      data: articleData({ status: 'DRAFT' }),
    });
    draftId = draft.id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('todo /admin sin token -> 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/articles/stats')
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${draftId}/publish`)
      .expect(401);
  });

  it('stats agrupa por estado (los seis)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/articles/stats')
      .set(auth())
      .expect(200);
    expect(res.body).toEqual({
      ingested: 0,
      draft: 1,
      inReview: 0,
      scheduled: 0,
      published: 0,
      spiked: 0,
    });
  });

  it('publicar un borrador sin título -> 422 con la lista de faltantes', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${draftId}/publish`)
      .set(auth())
      .expect(422);
    expect(res.body.missing).toEqual(['title', 'content', 'categoryId']);
    const article = await prisma.article.findUnique({
      where: { id: draftId },
    });
    expect(article?.status).toBe('DRAFT');
  });

  it('PATCH guarda ediciones sin cambiar el estado y deriva el cuerpo', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${draftId}`)
      .set(auth())
      .send({
        title: '  Título editado  ',
        kicker: 'Volanta',
        summary: 'Bajada',
        content: 'Cuerpo final de la nota\n\nSegundo párrafo',
        categoryId: economiaId,
      })
      .expect(200);
    expect(res.body.title).toBe('Título editado'); // el DTO recorta espacios
    expect(res.body.status).toBe('DRAFT');
    // el texto plano se convirtió en documento
    expect(res.body.contentJson.content).toHaveLength(2);
    expect(res.body.contentJson.content[0].type).toBe('paragraph');
    // y como es nota de feed, se midió la similaridad con la fuente
    expect(typeof res.body.sourceSimilarity).toBe('number');
    // el detalle incluye la fuente y la sección
    expect(res.body.source.sourceName).toBe('Fuente E2E');
    expect(res.body.categoryRef.name).toBe('Economía');
  });

  it('PATCH con contentJson: valida el doc y deriva el texto plano', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${draftId}`)
      .set(auth())
      .send({
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Cuerpo desde el editor' }],
            },
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Subtítulo' }],
            },
          ],
        },
      })
      .expect(200);
    expect(res.body.content).toBe('Cuerpo desde el editor\n\nSubtítulo');

    // un nodo fuera de la lista blanca -> 400
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${draftId}`)
      .set(auth())
      .send({ contentJson: { type: 'doc', content: [{ type: 'iframe' }] } })
      .expect(400);
  });

  it('PATCH con expectedUpdatedAt viejo -> 409 (otro guardó antes)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${draftId}`)
      .set(auth())
      .send({ title: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
      .expect(409);
  });

  it('publicar con todo completo: slug, fechas y revisor; visible en el sitio', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${draftId}/publish`)
      .set(auth())
      .expect(201);

    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.slug).toBe(`titulo-editado-${draftId.slice(-6)}`);
    expect(res.body.publishedAt).toBeTruthy();
    expect(res.body.firstPublishedAt).toBe(res.body.publishedAt);
    expect(res.body.reviewedBy.id).toBeTruthy();

    // y ahora es visible en el sitio público, con la sección por nombre
    const pub = await request(app.getHttpServer())
      .get(`/api/v1/articles/${res.body.slug}`)
      .expect(200);
    expect(pub.body.category).toBe('Economía');
    expect(pub.body.kicker).toBe('Volanta');
    expect(pub.body.sourceName).toBe('Fuente E2E');
  });

  it('re-publicar algo ya publicado -> 409 (transición inválida)', () => {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${draftId}/publish`)
      .set(auth())
      .expect(409);
  });

  it('editar una nota publicada es una corrección: crea revisión CORRECTION', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${draftId}`)
      .set(auth())
      .send({ summary: 'Bajada corregida', note: 'Error de tipeo' })
      .expect(200);
    const revs = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${draftId}/revisions`)
      .set(auth())
      .expect(200);
    expect(revs.body.data[0].reason).toBe('CORRECTION');
    expect(revs.body.data[0].note).toBe('Error de tipeo');
  });

  it('despublicar conserva el slug pero lo saca del sitio público', async () => {
    const slug = `titulo-editado-${draftId.slice(-6)}`;
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${draftId}/unpublish`)
      .set(auth())
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.slug).toBe(slug); // la URL es un compromiso con el lector
    expect(res.body.publishedAt).toBeNull();
    expect(res.body.firstPublishedAt).toBeTruthy(); // la primera vez no se borra

    await request(app.getHttpServer())
      .get(`/api/v1/articles/${slug}`)
      .expect(404);
  });

  it('re-publicar tras despublicar recupera la misma URL aunque cambie el título', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${draftId}`)
      .set(auth())
      .send({ title: 'Título completamente distinto' })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${draftId}/publish`)
      .set(auth())
      .expect(201);
    expect(res.body.slug).toBe(`titulo-editado-${draftId.slice(-6)}`);
  });

  it('descartar un borrador lo manda a SPIKED y se puede restaurar', async () => {
    const otro = await prisma.article.create({
      data: articleData({ status: 'DRAFT' }),
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${otro.id}/spike`)
      .set(auth())
      .expect(201);
    expect(res.body.status).toBe('SPIKED');
    expect(res.body.reviewedBy.id).toBeTruthy();

    const back = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${otro.id}/restore`)
      .set(auth())
      .expect(201);
    expect(back.body.status).toBe('DRAFT');
  });

  it('descartar una nota publicada -> 409 (hay que despublicar primero)', () => {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${draftId}/spike`)
      .set(auth())
      .expect(409);
  });

  it('listado admin por estado con paginación propia y sin el cuerpo', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/articles?status=PUBLISHED')
      .set(auth())
      .expect(200);
    expect(res.body.meta.limit).toBe(15); // default de publicadas
    expect(res.body.data[0].status).toBe('PUBLISHED');
    expect(res.body.data[0]).not.toHaveProperty('content');
    expect(res.body.data[0].source.sourceName).toBe('Fuente E2E');
  });

  it('listado admin: búsqueda libre y filtro por origen', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/articles?q=completamente&origin=FEED')
      .set(auth())
      .expect(200);
    expect(res.body.meta.total).toBe(1);
    const nada = await request(app.getHttpServer())
      .get('/api/v1/admin/articles?origin=ORIGINAL')
      .set(auth())
      .expect(200);
    expect(nada.body.meta.total).toBe(0);
  });

  it('id inexistente -> 404', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/articles/no-existe')
      .set(auth())
      .expect(404);
  });
});
