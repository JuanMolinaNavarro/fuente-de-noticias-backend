import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, getPrisma, loginAs, truncateAll } from './utils';

describe('Usuarios (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: { id: string; token: string };
  let nuevoId: string;

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    const a = await loginAs(app, prisma, {
      email: 'admin@test.com',
      role: 'ADMIN',
    });
    admin = { id: a.user.id, token: a.token };
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('ADMIN crea un usuario (REDACTOR por defecto) sin exponer el hash', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set(as(admin.token))
      .send({
        email: 'Nuevo@Test.com',
        name: 'Nuevo',
        password: 'clave-segura',
      })
      .expect(201);
    nuevoId = res.body.id;
    expect(res.body).toMatchObject({
      email: 'nuevo@test.com', // normalizado
      role: 'REDACTOR',
      isActive: true,
    });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('email duplicado -> 409; password corta -> 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set(as(admin.token))
      .send({ email: 'nuevo@test.com', name: 'Dup', password: 'clave-segura' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set(as(admin.token))
      .send({ email: 'otro@test.com', name: 'Otro', password: 'corta' })
      .expect(400);
  });

  it('el nuevo puede loguearse y ver su perfil', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nuevo@test.com', password: 'clave-segura' })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(as(login.body.accessToken))
      .expect(200);
    expect(me.body.role).toBe('REDACTOR');
  });

  it('cambia su propia contraseña (exige la actual)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nuevo@test.com', password: 'clave-segura' });
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set(as(login.body.accessToken))
      .send({ currentPassword: 'mala', newPassword: 'nueva-clave-1' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set(as(login.body.accessToken))
      .send({ currentPassword: 'clave-segura', newPassword: 'nueva-clave-1' })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nuevo@test.com', password: 'nueva-clave-1' })
      .expect(201);
  });

  it('ADMIN cambia rol y blanquea contraseña', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${nuevoId}`)
      .set(as(admin.token))
      .send({ role: 'EDITOR' })
      .expect(200);
    expect(res.body.role).toBe('EDITOR');
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${nuevoId}/password`)
      .set(as(admin.token))
      .send({ password: 'blanqueada-1' })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nuevo@test.com', password: 'blanqueada-1' })
      .expect(201);
  });

  it('un ADMIN no puede desactivarse ni quitarse el rol a sí mismo', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${admin.id}`)
      .set(as(admin.token))
      .send({ isActive: false })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${admin.id}`)
      .set(as(admin.token))
      .send({ role: 'EDITOR' })
      .expect(403);
  });

  it('el listado ordena por rol y nombre', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set(as(admin.token))
      .expect(200);
    expect(res.body.map((u: { email: string }) => u.email)).toEqual([
      'admin@test.com',
      'nuevo@test.com',
    ]);
  });
});
