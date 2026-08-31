import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PublishScheduler } from '../src/modules/admin-articles/publish.scheduler';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  articleData,
  createCategory,
  createTestApp,
  getPrisma,
  loginAs,
  truncateAll,
} from './utils';

describe('Publicación programada (e2e)', () => {
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
    const cat = await createCategory(prisma, 'Política');
    noteId = (
      await prisma.article.create({
        data: articleData({
          status: 'DRAFT',
          title: 'Programada',
          content: 'Cuerpo',
          categoryId: cat.id,
        }),
      })
    ).id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('publish con scheduledAt futuro -> SCHEDULED, slug reservado, no visible', async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${noteId}/publish`)
      .set(as(token))
      .send({ scheduledAt: future })
      .expect(201);
    expect(res.body.status).toBe('SCHEDULED');
    expect(res.body.slug).toBeTruthy();
    await request(app.getHttpServer())
      .get(`/api/v1/articles/${res.body.slug}`)
      .expect(404);
    // el cron no la libera antes de hora
    const n = await app.get(PublishScheduler).releaseDue(new Date());
    expect(n).toBe(0);
  });

  it('cuando llega la hora, releaseDue la publica con publishedAt = la hora programada', async () => {
    const a = await prisma.article.findUnique({ where: { id: noteId } });
    const despues = new Date(a!.scheduledAt!.getTime() + 60_000);
    const n = await app.get(PublishScheduler).releaseDue(despues);
    expect(n).toBe(1);
    const b = await prisma.article.findUnique({ where: { id: noteId } });
    expect(b?.status).toBe('PUBLISHED');
    expect(b?.publishedAt?.toISOString()).toBe(a!.scheduledAt!.toISOString());
    expect(b?.firstPublishedAt?.toISOString()).toBe(
      a!.scheduledAt!.toISOString(),
    );
    expect(b?.scheduledAt).toBeNull();
    await request(app.getHttpServer())
      .get(`/api/v1/articles/${b!.slug}`)
      .expect(200);
    // una segunda corrida no hace nada (ya no está SCHEDULED)
    expect(await app.get(PublishScheduler).releaseDue(new Date())).toBe(0);
  });

  it('unschedule vuelve a DRAFT y cancela la hora', async () => {
    const cat = await prisma.category.findFirst();
    const otra = await prisma.article.create({
      data: articleData({
        status: 'DRAFT',
        title: 'Otra',
        content: 'C',
        categoryId: cat!.id,
      }),
    });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${otra.id}/publish`)
      .set(as(token))
      .send({ scheduledAt: new Date(Date.now() + 3600_000).toISOString() })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/articles/${otra.id}/unschedule`)
      .set(as(token))
      .expect(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.scheduledAt).toBeNull();
    expect(res.body.slug).toBeTruthy(); // el slug reservado se conserva
  });
});
