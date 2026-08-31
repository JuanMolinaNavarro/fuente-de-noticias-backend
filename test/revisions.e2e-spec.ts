import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, getPrisma, loginAs, truncateAll } from './utils';

describe('Historial de revisiones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let editor: { id: string; token: string };
  let redactor: { id: string; token: string };
  let noteId: string;

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    const e = await loginAs(app, prisma, {
      email: 'e@test.com',
      role: 'EDITOR',
    });
    const r = await loginAs(app, prisma, {
      email: 'r@test.com',
      role: 'REDACTOR',
    });
    editor = { id: e.user.id, token: e.token };
    redactor = { id: r.user.id, token: r.token };
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set(as(editor.token))
      .send({ title: 'Versión uno', content: 'Cuerpo uno' })
      .expect(201);
    noteId = res.body.id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('el guardado normal se agrupa: dos PATCH seguidos del mismo usuario = una revisión AUTOSAVE', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${noteId}`)
      .set(as(editor.token))
      .send({ title: 'Versión dos' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${noteId}`)
      .set(as(editor.token))
      .send({ title: 'Versión tres' })
      .expect(200);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${noteId}/revisions`)
      .set(as(editor.token))
      .expect(200);
    // 1 (creación MANUAL) + 1 (AUTOSAVE agrupada)
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data[0].reason).toBe('AUTOSAVE');
    expect(res.body.data[0]).not.toHaveProperty('snapshot'); // no viaja en la lista
  });

  it('el detalle de una revisión trae el snapshot', async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${noteId}/revisions`)
      .set(as(editor.token));
    const creacion = list.body.data.find(
      (r: { version: number }) => r.version === 1,
    );
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${noteId}/revisions/${creacion.id}`)
      .set(as(editor.token))
      .expect(200);
    expect(res.body.snapshot.title).toBe('Versión uno');
    expect(res.body.snapshot.content).toBe('Cuerpo uno');
  });

  it('restaurar una revisión vuelve el contenido y deja una revisión RESTORE', async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${noteId}/revisions`)
      .set(as(editor.token));
    const creacion = list.body.data.find(
      (r: { version: number }) => r.version === 1,
    );
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/revisions/${creacion.id}/restore`)
      .set(as(editor.token))
      .expect(201);
    expect(res.body.title).toBe('Versión uno');
    expect(res.body.status).toBe('DRAFT'); // el estado no cambia

    const after = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${noteId}/revisions`)
      .set(as(editor.token));
    expect(after.body.data[0].reason).toBe('RESTORE');
    expect(after.body.data[0].note).toMatch(/versión 1/);
  });

  it('un redactor no restaura revisiones de una nota ajena (403)', async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${noteId}/revisions`)
      .set(as(redactor.token))
      .expect(200); // ver sí puede
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/articles/${noteId}/revisions/${list.body.data[0].id}/restore`,
      )
      .set(as(redactor.token))
      .expect(403);
  });

  it('revisión de otra nota -> 404', async () => {
    const otra = await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set(as(editor.token))
      .send({ title: 'Otra' });
    const list = await request(app.getHttpServer())
      .get(`/api/v1/admin/articles/${noteId}/revisions`)
      .set(as(editor.token));
    await request(app.getHttpServer())
      .get(
        `/api/v1/admin/articles/${otra.body.id}/revisions/${list.body.data[0].id}`,
      )
      .set(as(editor.token))
      .expect(404);
  });
});
