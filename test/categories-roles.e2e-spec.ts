import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, getPrisma, loginAs, truncateAll } from './utils';

/** Un editor puede CREAR secciones (le surge al armar la portada); renombrar
 *  o reordenar lo existente sigue siendo de ADMIN. */
describe('Roles sobre el catálogo de secciones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let editor: string;
  let redactor: string;

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    ({ token: editor } = await loginAs(app, prisma, {
      email: 'e@test.com',
      role: 'EDITOR',
    }));
    ({ token: redactor } = await loginAs(app, prisma, {
      email: 'r@test.com',
      role: 'REDACTOR',
    }));
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('un editor crea y lista secciones; editar una existente le da 403', async () => {
    const creada = await request(app.getHttpServer())
      .post('/api/v1/admin/categories')
      .set(as(editor))
      .send({ name: 'Espectáculos', slug: 'espectaculos', color: '#7B2FBE' })
      .expect(201);
    expect(creada.body.slug).toBe('espectaculos');

    const lista = await request(app.getHttpServer())
      .get('/api/v1/admin/categories')
      .set(as(editor))
      .expect(200);
    expect(lista.body.some((c: { slug: string }) => c.slug === 'espectaculos')).toBe(true);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/categories/${creada.body.id}`)
      .set(as(editor))
      .send({ name: 'Otro nombre' })
      .expect(403);
  });

  it('un redactor no toca el catálogo (403)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/categories')
      .set(as(redactor))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/categories')
      .set(as(redactor))
      .send({ name: 'X', slug: 'x', color: '#000000' })
      .expect(403);
  });
});
