import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createCategory,
  createTestApp,
  getPrisma,
  loginAs,
  truncateAll,
} from './utils';

/**
 * El flujo completo de una NOTA ORIGINAL escrita por un redactor:
 * crear → editar → enviar a revisión → el editor devuelve → corregir →
 * reenviar → publicar (o programar) → despublicar.
 */
describe('Flujo redactor → editor con nota original (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redactor: { id: string; token: string };
  let editor: { id: string; token: string };
  let deportesId: string;
  let noteId: string;

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    const r = await loginAs(app, prisma, {
      email: 'redactor@test.com',
      role: 'REDACTOR',
      name: 'Ramiro',
    });
    const e = await loginAs(app, prisma, {
      email: 'editor@test.com',
      role: 'EDITOR',
      name: 'Elena',
    });
    redactor = { id: r.user.id, token: r.token };
    editor = { id: e.user.id, token: e.token };
    deportesId = (await createCategory(prisma, 'Deportes')).id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('el redactor crea una nota original: DRAFT, ORIGINAL, sin fuente, con dueño', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set(as(redactor.token))
      .send({
        title: 'La selección sacó pasaje',
        tagNames: ['Selección', 'Mundial'],
      })
      .expect(201);
    noteId = res.body.id;
    expect(res.body).toMatchObject({
      origin: 'ORIGINAL',
      status: 'DRAFT',
      source: null,
      createdBy: { id: redactor.id, name: 'Ramiro' },
    });
    expect(
      res.body.tags.map((t: { tag: { name: string } }) => t.tag.name),
    ).toEqual(['Selección', 'Mundial']);
    // nace con una revisión "Creación"
    expect(res.body._count.revisions).toBe(1);
  });

  it('crear sin título -> 400 (validación del DTO)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set(as(redactor.token))
      .send({ kicker: 'x' })
      .expect(400);
  });

  it('el redactor edita su nota (cuerpo, bajada, sección, firma)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${noteId}`)
      .set(as(redactor.token))
      .send({
        kicker: 'Fútbol juvenil',
        summary: 'Con un 2-0 sólido.',
        content: 'La selección juvenil venció 2 a 0.\n\nCerró invicta.',
        categoryId: deportesId,
        authorIds: [redactor.id],
      })
      .expect(200);
    expect(res.body.authors[0].user.name).toBe('Ramiro');
    expect(res.body.sourceSimilarity).toBeNull(); // no hay fuente que medir
    expect(res.body.lastEditedBy.id).toBe(redactor.id);
  });

  it('enviar a revisión: DRAFT -> IN_REVIEW', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/submit`)
      .set(as(redactor.token))
      .expect(201);
    expect(res.body.status).toBe('IN_REVIEW');
  });

  it('en revisión el redactor ya no puede editarla ni reenviarla (403: no es "su borrador")', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${noteId}`)
      .set(as(redactor.token))
      .send({ title: 'x' })
      .expect(403);
    // la política (¿puede el actor?) se evalúa antes que la transición
    // (¿es legal para la nota?), por eso 403 y no 409
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/submit`)
      .set(as(redactor.token))
      .expect(403);
    // el editor sí choca con la transición ilegal
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/submit`)
      .set(as(editor.token))
      .expect(409);
  });

  it('el editor devuelve con nota obligatoria: IN_REVIEW -> DRAFT', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/return`)
      .set(as(editor.token))
      .send({})
      .expect(400); // note es obligatoria en el DTO
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/return`)
      .set(as(editor.token))
      .send({ note: 'Falta la fecha del partido' })
      .expect(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.reviewNote).toBe('Falta la fecha del partido');
    expect(res.body.reviewedBy.id).toBe(editor.id);
  });

  it('el redactor corrige y reenvía; la nota de devolución se limpia', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${noteId}`)
      .set(as(redactor.token))
      .send({ content: 'La selección juvenil venció 2 a 0 el sábado.' })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/submit`)
      .set(as(redactor.token))
      .expect(201);
    expect(res.body.status).toBe('IN_REVIEW');
    expect(res.body.reviewNote).toBeNull();
  });

  it('el editor programa la publicación: IN_REVIEW -> SCHEDULED con slug reservado', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/publish`)
      .set(as(editor.token))
      .send({ scheduledAt: future })
      .expect(201);
    expect(res.body.status).toBe('SCHEDULED');
    expect(res.body.slug).toBe(`la-seleccion-saco-pasaje-${noteId.slice(-6)}`);
    expect(res.body.publishedAt).toBeNull();

    // no es visible en el sitio
    await request(app.getHttpServer())
      .get(`/api/v1/articles/${res.body.slug}`)
      .expect(404);
  });

  it('desprogramar vuelve a DRAFT; publicar ya la hace visible con firma y tags', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/unschedule`)
      .set(as(editor.token))
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/publish`)
      .set(as(editor.token))
      .expect(201);
    expect(res.body.status).toBe('PUBLISHED');

    const pub = await request(app.getHttpServer())
      .get(`/api/v1/articles/${res.body.slug}`)
      .expect(200);
    expect(pub.body.origin).toBe('ORIGINAL');
    expect(pub.body.sourceName).toBeNull();
    expect(pub.body.sourceUrl).toBeNull();
    expect(pub.body.authors).toEqual([{ id: redactor.id, name: 'Ramiro' }]);
    expect(pub.body.tags.map((t: { slug: string }) => t.slug)).toEqual([
      'seleccion',
      'mundial',
    ]);
    expect(pub.body.contentJson.type).toBe('doc');
  });

  it('las transiciones quedan en la auditoría', async () => {
    const admin = await loginAs(app, prisma, {
      email: 'admin@test.com',
      role: 'ADMIN',
    });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit?entity=article&entityId=${noteId}`)
      .set(as(admin.token))
      .expect(200);
    const actions = res.body.data.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'create',
        'update',
        'submit',
        'return',
        'publish',
      ]),
    );
    // un EDITOR no ve la auditoría
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set(as(editor.token))
      .expect(403);
  });
});
