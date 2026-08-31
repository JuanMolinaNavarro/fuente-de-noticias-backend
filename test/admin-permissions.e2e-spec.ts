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
 * Permisos por rol. Dos capas: @Roles en el controller (403 antes de tocar
 * la base) y article-policy en el service (403 según dueño y estado).
 */
describe('Permisos por rol (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redactor: { id: string; token: string };
  let otroRedactor: { id: string; token: string };
  let editor: { id: string; token: string };
  let admin: { id: string; token: string };
  let feedDraftId: string; // nota de feed, sin dueño
  let ownDraftId: string; // nota original del redactor

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    const mk = async (email: string, role: 'REDACTOR' | 'EDITOR' | 'ADMIN') => {
      const r = await loginAs(app, prisma, { email, role });
      return { id: r.user.id, token: r.token };
    };
    redactor = await mk('r1@test.com', 'REDACTOR');
    otroRedactor = await mk('r2@test.com', 'REDACTOR');
    editor = await mk('e@test.com', 'EDITOR');
    admin = await mk('a@test.com', 'ADMIN');
    const cat = await createCategory(prisma, 'Sociedad');

    feedDraftId = (
      await prisma.article.create({
        data: articleData({
          status: 'DRAFT',
          title: 'De feed',
          content: 'Cuerpo',
          categoryId: cat.id,
        }),
      })
    ).id;
    const own = await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set(as(redactor.token))
      .send({ title: 'Mi nota', categoryId: cat.id, content: 'Cuerpo propio' })
      .expect(201);
    ownDraftId = own.body.id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  describe('REDACTOR', () => {
    it('ve la bandeja y cualquier nota', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/articles')
        .set(as(redactor.token))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/admin/articles/${feedDraftId}`)
        .set(as(redactor.token))
        .expect(200);
    });

    it('no edita una nota ajena ni una de feed (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/articles/${feedDraftId}`)
        .set(as(redactor.token))
        .send({ title: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/articles/${ownDraftId}`)
        .set(as(otroRedactor.token))
        .send({ title: 'x' })
        .expect(403);
    });

    it('sí edita y descarta la propia', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/articles/${ownDraftId}`)
        .set(as(redactor.token))
        .send({ kicker: 'Mía' })
        .expect(200);
    });

    it('no publica, devuelve, despublica ni restaura (403 por @Roles)', async () => {
      for (const action of ['publish', 'unpublish', 'unschedule', 'restore']) {
        await request(app.getHttpServer())
          .post(`/api/v1/admin/articles/${ownDraftId}/${action}`)
          .set(as(redactor.token))
          .expect(403);
      }
      await request(app.getHttpServer())
        .post(`/api/v1/admin/articles/${ownDraftId}/return`)
        .set(as(redactor.token))
        .send({ note: 'x' })
        .expect(403);
    });

    it('sí ve el directorio de firmas (id + nombre)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/users/directory')
        .set(as(redactor.token))
        .expect(200);
      expect(res.body[0]).toEqual({
        id: expect.any(String),
        name: expect.any(String),
      });
      expect(res.body[0]).not.toHaveProperty('email');
    });

    it('no gestiona usuarios ni ve la auditoría', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set(as(redactor.token))
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit')
        .set(as(redactor.token))
        .expect(403);
    });
  });

  describe('EDITOR', () => {
    it('edita cualquier nota, incluida la de un redactor y la de feed', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/articles/${ownDraftId}`)
        .set(as(editor.token))
        .send({ summary: 'Bajada del editor' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/articles/${feedDraftId}`)
        .set(as(editor.token))
        .send({ summary: 'Bajada' })
        .expect(200);
    });

    it('publica y despublica', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/articles/${feedDraftId}/publish`)
        .set(as(editor.token))
        .expect(201);
      expect(res.body.status).toBe('PUBLISHED');
      await request(app.getHttpServer())
        .post(`/api/v1/admin/articles/${feedDraftId}/unpublish`)
        .set(as(editor.token))
        .expect(201);
    });

    it('no gestiona usuarios (403)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/admin/users')
        .set(as(editor.token))
        .send({ email: 'x@test.com', name: 'X', password: 'clave-segura' })
        .expect(403);
    });
  });

  describe('ADMIN', () => {
    it('hace todo lo del editor y además gestiona usuarios', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/articles/${ownDraftId}`)
        .set(as(admin.token))
        .send({ summary: 'Bajada del admin' })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set(as(admin.token))
        .expect(200);
    });
  });

  describe('usuario desactivado', () => {
    it('su token vigente deja de servir de inmediato', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${otroRedactor.id}`)
        .set(as(admin.token))
        .send({ isActive: false })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/admin/articles')
        .set(as(otroRedactor.token))
        .expect(401);
      // y tampoco puede loguearse (misma respuesta que credenciales inválidas)
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'r2@test.com', password: 'clave-segura' })
        .expect(401);
    });
  });
});
