import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { CleanupScheduler } from '../src/modules/admin-articles/cleanup.scheduler';
import { PrismaService } from '../src/prisma/prisma.service';
import { articleData, createTestApp, getPrisma, truncateAll } from './utils';

const HORA = 3_600_000;
const DIA = 24 * HORA;

describe('Purga de borradores de feed (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: CleanupScheduler;

  const haceDias = (n: number) => new Date(Date.now() - n * DIA);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    scheduler = app.get(CleanupScheduler);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('borrador de feed vencido -> se purga, deja lápida y auditoría', async () => {
    const viejo = await prisma.article.create({
      data: articleData(
        {
          status: 'DRAFT',
          title: 'Borrador abandonado',
          fetchedAt: haceDias(3),
        },
        { guid: 'purge-guid-1', feedUrl: 'https://feed.test/rss' },
      ),
    });

    expect(await scheduler.purgeStale()).toBe(1);

    // el artículo (y su source, por cascade) ya no existen
    expect(
      await prisma.article.findUnique({ where: { id: viejo.id } }),
    ).toBeNull();

    // quedó la lápida con el guid del feed
    const lapida = await prisma.ingestTombstone.findUnique({
      where: { guid: 'purge-guid-1' },
    });
    expect(lapida).not.toBeNull();
    expect(lapida?.feedUrl).toBe('https://feed.test/rss');
    expect(lapida?.title).toBe('Borrador abandonado');

    // y una entrada de auditoría por la corrida
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'purgeStaleDrafts' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.diff).toMatchObject({ count: 1, ids: [viejo.id] });
  });

  it('sobreviven: feed fresco y original viejo', async () => {
    const fresco = await prisma.article.create({
      data: articleData({
        status: 'DRAFT',
        title: 'Feed fresco',
        fetchedAt: new Date(Date.now() - 1 * HORA),
      }),
    });
    const original = await prisma.article.create({
      data: {
        origin: 'ORIGINAL',
        status: 'DRAFT',
        title: 'Nota propia vieja',
        fetchedAt: haceDias(3),
      },
    });

    expect(await scheduler.purgeStale()).toBe(0);

    expect(
      await prisma.article.findUnique({ where: { id: fresco.id } }),
    ).not.toBeNull();
    expect(
      await prisma.article.findUnique({ where: { id: original.id } }),
    ).not.toBeNull();
  });

  it('sobreviven: feed viejo pero ya en revisión o publicado', async () => {
    const enRevision = await prisma.article.create({
      data: articleData({
        status: 'IN_REVIEW',
        title: 'En revisión',
        fetchedAt: haceDias(3),
      }),
    });
    const publicado = await prisma.article.create({
      data: articleData({
        status: 'PUBLISHED',
        title: 'Publicado',
        slug: 'publicado-viejo',
        publishedAt: haceDias(2),
        fetchedAt: haceDias(3),
      }),
    });

    expect(await scheduler.purgeStale()).toBe(0);

    expect(
      await prisma.article.findUnique({ where: { id: enRevision.id } }),
    ).not.toBeNull();
    expect(
      await prisma.article.findUnique({ where: { id: publicado.id } }),
    ).not.toBeNull();
  });

  it('lápidas: pasada la retención se borran, las recientes quedan', async () => {
    await prisma.ingestTombstone.create({
      data: {
        guid: 'lapida-vieja',
        feedUrl: 'https://feed.test/rss',
        deletedAt: haceDias(90),
      },
    });
    await prisma.ingestTombstone.create({
      data: {
        guid: 'lapida-reciente',
        feedUrl: 'https://feed.test/rss',
        deletedAt: haceDias(5),
      },
    });

    expect(await scheduler.purgeStale()).toBe(0);

    expect(
      await prisma.ingestTombstone.findUnique({
        where: { guid: 'lapida-vieja' },
      }),
    ).toBeNull();
    expect(
      await prisma.ingestTombstone.findUnique({
        where: { guid: 'lapida-reciente' },
      }),
    ).not.toBeNull();
  });
});
