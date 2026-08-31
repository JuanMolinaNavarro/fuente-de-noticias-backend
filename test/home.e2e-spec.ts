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

describe('Portada curada (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let editor: { id: string; token: string };
  let redactor: { id: string; token: string };
  const ids: string[] = []; // 8 publicadas, de la más nueva a la más vieja

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
    const cat = await createCategory(prisma, 'Tucumán');
    for (let i = 0; i < 8; i++) {
      const a = await prisma.article.create({
        data: articleData({
          status: 'PUBLISHED',
          title: `Nota ${i}`,
          content: 'Cuerpo',
          slug: `nota-${i}`,
          categoryId: cat.id,
          publishedAt: new Date(Date.UTC(2026, 7, 10, 12, 0, 0) - i * 3600_000),
          isBreaking: i === 2,
        }),
      });
      ids.push(a.id);
    }
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('sin curación, GET /home es cronológica y trae la última hora', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/home')
      .expect(200);
    expect(res.body.curadaAt).toBeNull();
    expect(res.body.principal.title).toBe('Nota 0');
    expect(res.body.destacadas.map((a: { title: string }) => a.title)).toEqual([
      'Nota 1',
      'Nota 2',
      'Nota 3',
      'Nota 4',
      'Nota 5',
      'Nota 6',
    ]);
    expect(res.body.mas.map((a: { title: string }) => a.title)).toEqual([
      'Nota 7',
    ]);
    expect(res.body.breaking.map((a: { title: string }) => a.title)).toEqual([
      'Nota 2',
    ]);
  });

  it('un redactor no cura la portada (403)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/home')
      .set(as(redactor.token))
      .expect(403);
  });

  it('el editor arma zonas; una nota no puede estar en dos; respeta cupos', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/home/slots')
      .set(as(editor.token))
      .send({ zone: 'PRINCIPAL', articleIds: [ids[5]] })
      .expect(200);
    const res = await request(app.getHttpServer())
      .put('/api/v1/admin/home/slots')
      .set(as(editor.token))
      .send({ zone: 'DESTACADAS', articleIds: [ids[7], ids[5], ids[0]] })
      .expect(200);
    // ids[5] se movió de PRINCIPAL a DESTACADAS
    expect(res.body.zonas.PRINCIPAL).toHaveLength(0);
    expect(
      res.body.zonas.DESTACADAS.map(
        (s: { article: { title: string } }) => s.article.title,
      ),
    ).toEqual(['Nota 7', 'Nota 5', 'Nota 0']);
    expect(res.body.cambiosSinPublicar).toBe(true);

    await request(app.getHttpServer())
      .put('/api/v1/admin/home/slots')
      .set(as(editor.token))
      .send({ zone: 'PRINCIPAL', articleIds: [ids[1], ids[2]] })
      .expect(400); // cupo 1
    const draft = await prisma.article.create({
      data: articleData({ status: 'DRAFT', title: 'Borrador' }),
    });
    await request(app.getHttpServer())
      .put('/api/v1/admin/home/slots')
      .set(as(editor.token))
      .send({ zone: 'PRINCIPAL', articleIds: [draft.id] })
      .expect(400); // no publicada
  });

  it('el borrador NO se ve en el sitio hasta "Publicar portada"', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/home')
      .expect(200);
    expect(res.body.curadaAt).toBeNull();
    expect(res.body.principal.title).toBe('Nota 0');
  });

  it('publicar crea una versión; el sitio la sirve y rellena lo que falta sin repetir', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/home/slots')
      .set(as(editor.token))
      .send({ zone: 'PRINCIPAL', articleIds: [ids[3]] })
      .expect(200);
    const pub = await request(app.getHttpServer())
      .post('/api/v1/admin/home/publish')
      .set(as(editor.token))
      .expect(201);
    expect(pub.body.publishedBy.id).toBe(editor.id);

    const res = await request(app.getHttpServer())
      .get('/api/v1/home')
      .expect(200);
    expect(res.body.curadaAt).toBeTruthy();
    expect(res.body.principal.title).toBe('Nota 3');
    const dest = res.body.destacadas.map((a: { title: string }) => a.title);
    // curadas primero, en su orden, y luego relleno cronológico sin repetir
    expect(dest.slice(0, 3)).toEqual(['Nota 7', 'Nota 5', 'Nota 0']);
    expect(dest).toHaveLength(6);
    const todas = [
      res.body.principal.title,
      ...dest,
      ...res.body.mas.map((a: { title: string }) => a.title),
    ];
    expect(new Set(todas).size).toBe(todas.length); // sin duplicados
    expect(todas).toHaveLength(8); // 8 publicadas en total

    const draft = await request(app.getHttpServer())
      .get('/api/v1/admin/home')
      .set(as(editor.token));
    expect(draft.body.cambiosSinPublicar).toBe(false);
  });

  it('si una nota curada se despublica, la portada se rellena sola', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${ids[3]}/unpublish`)
      .set(as(editor.token))
      .expect(201);
    const res = await request(app.getHttpServer())
      .get('/api/v1/home')
      .expect(200);
    expect(res.body.principal.title).not.toBe('Nota 3');
    expect(res.body.principal).toBeTruthy();
  });

  it('versiones: listar y volver a una anterior', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/home/slots')
      .set(as(editor.token))
      .send({ zone: 'PRINCIPAL', articleIds: [ids[6]] });
    await request(app.getHttpServer())
      .post('/api/v1/admin/home/publish')
      .set(as(editor.token));
    const vs = await request(app.getHttpServer())
      .get('/api/v1/admin/home/versions')
      .set(as(editor.token))
      .expect(200);
    expect(vs.body.length).toBe(2);
    const primera = vs.body[1];
    await request(app.getHttpServer())
      .post(`/api/v1/admin/home/versions/${primera.id}/republish`)
      .set(as(editor.token))
      .expect(201);
    const vs2 = await request(app.getHttpServer())
      .get('/api/v1/admin/home/versions')
      .set(as(editor.token));
    expect(vs2.body.length).toBe(3); // volver = nueva versión, no se pierde historia
  });
});
