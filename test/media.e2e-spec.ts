import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
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

/** PNG real de prueba (sharp genera el binario; no dependemos de fixtures). */
async function pngDePrueba(w = 2400, h = 1600) {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 30, g: 58, b: 107 },
    },
  })
    .png()
    .toBuffer();
}

describe('Biblioteca de medios (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let mediaId: string;
  const uploadsDir = resolve(process.env.MEDIA_LOCAL_DIR ?? './uploads');

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    ({ token } = await loginAs(app, prisma, {
      email: 'r@test.com',
      role: 'REDACTOR',
    }));
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('sube un PNG: genera webp principal (≤1600) y miniatura (≤800), guarda la ficha', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/media')
      .set(as(token))
      .field('alt', 'Puente sobre el río Salí')
      .field('caption', 'El nuevo puente, el día de la inauguración')
      .attach('file', await pngDePrueba(), 'puente.png')
      .expect(201);
    mediaId = res.body.id;
    expect(res.body).toMatchObject({
      mimeType: 'image/webp',
      width: 1600, // reescalada desde 2400
      alt: 'Puente sobre el río Salí',
    });
    expect(res.body.height).toBe(1067);
    expect(res.body.url).toMatch(/\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);
    expect(res.body.thumbUrl).toMatch(/-sm\.webp$/);
    // el archivo existe en disco (storage local)
    const key = res.body.storageKey as string;
    expect(existsSync(resolve(uploadsDir, key))).toBe(true);
    await rm(resolve(uploadsDir, key), { force: true });
    await rm(resolve(uploadsDir, key.replace('.webp', '-sm.webp')), {
      force: true,
    });
  });

  it('una imagen chica no se agranda', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/media')
      .set(as(token))
      .attach('file', await pngDePrueba(400, 300), 'chica.png')
      .expect(201);
    expect(res.body.width).toBe(400);
    await rm(resolve(uploadsDir, res.body.storageKey as string), {
      force: true,
    });
    await rm(
      resolve(
        uploadsDir,
        (res.body.storageKey as string).replace('.webp', '-sm.webp'),
      ),
      { force: true },
    );
  });

  it('sube sin crédito ni metadatos; tipo no admitido -> 400; sin archivo -> 400', async () => {
    // El crédito dejó de ser obligatorio: una subida sin metadatos funciona
    const ok = await request(app.getHttpServer())
      .post('/api/v1/admin/media')
      .set(as(token))
      .attach('file', await pngDePrueba(100, 100), 'x.png')
      .expect(201);
    await rm(resolve(uploadsDir, ok.body.storageKey as string), {
      force: true,
    });
    await rm(
      resolve(
        uploadsDir,
        (ok.body.storageKey as string).replace('.webp', '-sm.webp'),
      ),
      { force: true },
    );
    await request(app.getHttpServer())
      .post('/api/v1/admin/media')
      .set(as(token))
      .attach('file', Buffer.from('hola'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/admin/media')
      .set(as(token))
      .expect(400);
  });

  it('un archivo que dice ser imagen pero no lo es -> 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/media')
      .set(as(token))
      .attach('file', Buffer.from('no soy un png'), {
        filename: 'falso.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('lista y busca por epígrafe/alt; PATCH edita metadatos y punto focal', async () => {
    const lista = await request(app.getHttpServer())
      .get('/api/v1/admin/media?q=puente')
      .set(as(token))
      .expect(200);
    expect(lista.body.meta.total).toBe(1);
    expect(lista.body.data[0].id).toBe(mediaId);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/admin/media/${mediaId}`)
      .set(as(token))
      .send({ caption: 'Vista aérea del puente', focalX: 0.3, focalY: 0.6 })
      .expect(200);
    expect(res.body.caption).toBe('Vista aérea del puente');
    expect(res.body.focalX).toBe(0.3);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/media/${mediaId}`)
      .set(as(token))
      .send({ focalX: 2 })
      .expect(400);
  });

  it('se usa como imagen destacada y el público la ve con epígrafe', async () => {
    const editor = await loginAs(app, prisma, {
      email: 'e@test.com',
      role: 'EDITOR',
    });
    const cat = await createCategory(prisma, 'Tucumán');
    const a = await prisma.article.create({
      data: articleData({
        status: 'DRAFT',
        title: 'Con foto',
        content: 'Cuerpo',
        categoryId: cat.id,
      }),
    });
    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${a.id}`)
      .set(as(editor.token))
      .send({ featuredMediaId: mediaId })
      .expect(200);
    expect(patch.body.featuredMedia.id).toBe(mediaId);

    const pub = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${a.id}/publish`)
      .set(as(editor.token))
      .expect(201);
    const det = await request(app.getHttpServer())
      .get(`/api/v1/articles/${pub.body.slug}`)
      .expect(200);
    expect(det.body.imageUrl).toBe(patch.body.featuredMedia.url);
    expect(det.body.featuredMedia).toMatchObject({
      caption: 'Vista aérea del puente',
      focalX: 0.3,
    });
    // no se filtra nada interno de Media (y el crédito ya no se expone)
    expect(det.body.featuredMedia).not.toHaveProperty('storageKey');
    expect(det.body.featuredMedia).not.toHaveProperty('uploadedById');
    expect(det.body.featuredMedia).not.toHaveProperty('credit');

    // quitar la destacada: "" -> null
    const sin = await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${a.id}`)
      .set(as(editor.token))
      .send({ featuredMediaId: '' })
      .expect(200);
    expect(sin.body.featuredMedia).toBeNull();
  });

  it('el cuerpo acepta el nodo image con epígrafe y crédito', async () => {
    const editor = await loginAs(app, prisma, {
      email: 'e2@test.com',
      role: 'EDITOR',
    });
    const a = await prisma.article.create({
      data: articleData({ status: 'DRAFT', title: 'Con imagen en el cuerpo' }),
    });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${a.id}`)
      .set(as(editor.token))
      .send({
        contentJson: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Antes.' }] },
            {
              type: 'image',
              attrs: {
                mediaId,
                src: 'http://localhost:4000/uploads/x.webp',
                alt: 'alt',
                caption: 'Epígrafe',
                credit: 'Crédito',
              },
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Después.' }],
            },
          ],
        },
      })
      .expect(200);
    expect(res.body.content).toBe('Antes.\n\n[Foto: Epígrafe]\n\nDespués.');
    // src no http -> 400
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${a.id}`)
      .set(as(editor.token))
      .send({
        contentJson: {
          type: 'doc',
          content: [{ type: 'image', attrs: { src: 'javascript:x' } }],
        },
      })
      .expect(400);
  });
});
