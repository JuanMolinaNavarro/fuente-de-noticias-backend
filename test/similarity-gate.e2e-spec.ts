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

const FUENTE =
  'El directorio del Banco Central resolvió este jueves una baja de la tasa de política monetaria del 35% al 32% anual, en línea con la desaceleración de la inflación de los últimos tres meses. La decisión fue anunciada tras la reunión de directorio y analistas esperaban un recorte de esta magnitud.';

/** La similaridad con la fuente se mide y se muestra como advertencia, pero
 *  publicar es decisión del editor: no bloquea (decisión editorial 2026-08). */
describe('Medición de similaridad con la fuente (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let catId: string;

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    ({ token } = await loginAs(app, prisma, {
      email: 'e@test.com',
      role: 'EDITOR',
    }));
    catId = (await createCategory(prisma, 'Economía')).id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('copia literal de la fuente -> PATCH mide ~100 % pero publica igual', async () => {
    const a = await prisma.article.create({
      data: articleData(
        { status: 'DRAFT', title: 'Copia', categoryId: catId },
        { originalContent: FUENTE },
      ),
    });
    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${a.id}`)
      .set(as(token))
      .send({ content: FUENTE })
      .expect(200);
    expect(patch.body.sourceSimilarity).toBeGreaterThan(0.9);

    // La métrica se conserva en la respuesta para que el panel la muestre,
    // pero ya no impide la publicación.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${a.id}/publish`)
      .set(as(token))
      .expect(201);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.sourceSimilarity).toBeGreaterThan(0.9);
  });

  it('nota reescrita con palabras propias -> publica', async () => {
    const a = await prisma.article.create({
      data: articleData(
        { status: 'DRAFT', title: 'Propia', categoryId: catId },
        { originalContent: FUENTE },
      ),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${a.id}`)
      .set(as(token))
      .send({
        content:
          'El Central recortó tres puntos su tasa de referencia y la dejó en 32 por ciento.\n\nEs el tercer ajuste a la baja del año y el mercado lo daba por descontado.\n\nLa información fue publicada originalmente por Fuente E2E.',
      })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${a.id}/publish`)
      .set(as(token))
      .expect(201);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.sourceSimilarity).toBeLessThan(0.25);
  });

  it('una nota ORIGINAL no se mide contra nada', async () => {
    const own = await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set(as(token))
      .send({ title: 'Original', content: FUENTE, categoryId: catId })
      .expect(201);
    expect(own.body.sourceSimilarity).toBeNull();
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${own.body.id}/publish`)
      .set(as(token))
      .expect(201);
  });
});
