import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, getPrisma, truncateAll } from './utils';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    await createUser(prisma, {
      email: 'editor@test.com',
      password: 'clave-segura',
    });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('login válido devuelve accessToken y el usuario sin passwordHash', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'editor@test.com', password: 'clave-segura' })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe('editor@test.com');
    expect(res.body.user.role).toBe('EDITOR');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('password incorrecta -> 401', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'editor@test.com', password: 'incorrecta' })
      .expect(401);
  });

  it('email inexistente -> 401 (misma respuesta: no revela qué falló)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nadie@test.com', password: 'lo-que-sea' })
      .expect(401);
  });

  it('body inválido -> 400 antes de tocar la lógica', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'no-es-un-email', password: '' })
      .expect(400);
  });

  it('GET /auth/me con token devuelve el usuario', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'editor@test.com', password: 'clave-segura' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(res.body.email).toBe('editor@test.com');
  });

  it('GET /auth/me sin token -> 401', () => {
    return request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });
});
