import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, getPrisma, loginAs, truncateAll } from './utils';

describe('Vista previa por token (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let noteId: string;

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    ({ token } = await loginAs(app, prisma, {
      email: 'e@test.com',
      role: 'EDITOR',
    }));
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set(as(token))
      .send({ title: 'Nota secreta', content: 'Todavía no publicada' })
      .expect(201);
    noteId = res.body.id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('el panel emite un token y el público lo canjea por la nota aunque sea DRAFT', async () => {
    const t = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/preview-token`)
      .set(as(token))
      .expect(201);
    expect(t.body.token).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get(`/api/v1/articles/preview/${t.body.token}`)
      .expect(200);
    expect(res.body.title).toBe('Nota secreta');
    expect(res.body.content).toBe('Todavía no publicada');
    expect(res.body).not.toHaveProperty('status');
  });

  it('token inválido, de otro tipo o vencido -> 404 (para el público no existe)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/articles/preview/no-es-un-jwt')
      .expect(404);
    // un token de sesión (kind ≠ preview) tampoco sirve
    await request(app.getHttpServer())
      .get(`/api/v1/articles/preview/${token}`)
      .expect(404);
  });

  it('emitir token para una nota inexistente -> 404', () => {
    return request(app.getHttpServer())
      .post('/api/v1/admin/articles/no-existe/preview-token')
      .set(as(token))
      .expect(404);
  });
});
