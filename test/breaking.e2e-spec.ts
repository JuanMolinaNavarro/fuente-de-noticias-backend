import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

/** El cupo de Última hora es 3 (lo que muestra el ticker del home): al marcar
 *  una nueva urgente, la más vieja sale sola (FIFO por breakingSince). */
describe('Cupo FIFO de Última hora (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let catId: string;

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  const enUnaHora = () => new Date(Date.now() + 3600_000).toISOString();

  const marcarUrgente = (id: string) =>
    request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${id}`)
      .set(as(token))
      .send({ isBreaking: true, breakingUntil: enUnaHora() })
      .expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    await truncateAll(prisma);
    ({ token } = await loginAs(app, prisma, {
      email: 'e@test.com',
      role: 'EDITOR',
    }));
    catId = (await createCategory(prisma, 'Urgente')).id;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('la cuarta urgente empuja afuera a la primera; las demás quedan', async () => {
    const notas: { id: string }[] = [];
    for (let i = 1; i <= 4; i++) {
      notas.push(
        await prisma.article.create({
          data: articleData({
            status: 'DRAFT',
            title: `Urgente ${i}`,
            content: 'Cuerpo',
            categoryId: catId,
          }),
        }),
      );
    }
    // Se marcan en orden: 1, 2, 3 llenan el cupo...
    for (const n of notas.slice(0, 3)) await marcarUrgente(n.id);
    // ...y la 4 desplaza a la 1 (FIFO)
    await marcarUrgente(notas[3].id);

    const estados = await prisma.article.findMany({
      where: { id: { in: notas.map((n) => n.id) } },
      orderBy: { title: 'asc' },
      select: { title: true, isBreaking: true, breakingSince: true },
    });
    expect(estados.map((e) => e.isBreaking)).toEqual([false, true, true, true]);
    expect(estados[0].breakingSince).toBeNull();

    // La salida queda auditada como acción del sistema
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'breakingRotated', entityId: notas[0].id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBeNull();
  });

  it('re-guardar una nota que YA es urgente no rota a nadie', async () => {
    // Del caso anterior quedan 2, 3 y 4 activas: re-marcar la 4 no cambia nada
    const cuarta = await prisma.article.findFirstOrThrow({
      where: { title: 'Urgente 4' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${cuarta.id}`)
      .set(as(token))
      .send({ isBreaking: true, summary: 'bajada nueva' })
      .expect(200);
    const activas = await prisma.article.count({ where: { isBreaking: true } });
    expect(activas).toBe(3);
    const segunda = await prisma.article.findFirstOrThrow({
      where: { title: 'Urgente 2' },
    });
    expect(segunda.isBreaking).toBe(true);
  });

  it('una urgente vencida (breakingUntil pasado) no ocupa cupo', async () => {
    // Vence la 2 → quedan 2 activas; una nueva entra sin desplazar a nadie
    await prisma.article.updateMany({
      where: { title: 'Urgente 2' },
      data: { breakingUntil: new Date(Date.now() - 60_000) },
    });
    const nueva = await prisma.article.create({
      data: articleData({
        status: 'DRAFT',
        title: 'Urgente 5',
        content: 'Cuerpo',
        categoryId: catId,
      }),
    });
    await marcarUrgente(nueva.id);
    const tercera = await prisma.article.findFirstOrThrow({
      where: { title: 'Urgente 3' },
    });
    expect(tercera.isBreaking).toBe(true);
  });

  /* ── Vencimiento obligatorio ─────────────────────────────────────── */

  const crearNota = (
    title: string,
    extra: Partial<Prisma.ArticleUncheckedCreateInput> = {},
  ) =>
    prisma.article.create({
      data: articleData({
        status: 'DRAFT',
        title,
        content: 'Cuerpo',
        categoryId: catId,
        ...extra,
      }),
    });

  const patch = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/api/v1/admin/articles/${id}`)
      .set(as(token))
      .send(body);

  it('marcar urgente sin vencimiento devuelve 400', async () => {
    const nota = await crearNota('Sin fecha');
    const r = await patch(nota.id, { isBreaking: true }).expect(400);
    expect(r.body.message).toContain('vencimiento');
  });

  it('marcar urgente con vencimiento pasado devuelve 400', async () => {
    const nota = await crearNota('Fecha pasada');
    await patch(nota.id, {
      isBreaking: true,
      breakingUntil: new Date(Date.now() - 60_000).toISOString(),
    }).expect(400);
  });

  it('a una nota ya urgente no se le puede poner vencimiento pasado', async () => {
    const nota = await crearNota('Ya urgente');
    await marcarUrgente(nota.id);
    await patch(nota.id, {
      breakingUntil: new Date(Date.now() - 60_000).toISOString(),
    }).expect(400);
  });

  it('una nota legacy (urgente sin fecha) se puede editar sin tocar la urgencia', async () => {
    const nota = await crearNota('Legacy', {
      isBreaking: true,
      breakingUntil: null,
    });
    await patch(nota.id, { title: 'Legacy con título nuevo' }).expect(200);
    const enDb = await prisma.article.findUniqueOrThrow({
      where: { id: nota.id },
    });
    expect(enDb.title).toBe('Legacy con título nuevo');
    expect(enDb.isBreaking).toBe(true); // no se tocó, no se valida
  });

  it('desmarcar urgente limpia vencimiento y sello', async () => {
    const nota = await crearNota('Para desmarcar');
    await marcarUrgente(nota.id);
    await patch(nota.id, { isBreaking: false }).expect(200);
    const enDb = await prisma.article.findUniqueOrThrow({
      where: { id: nota.id },
    });
    expect(enDb.isBreaking).toBe(false);
    expect(enDb.breakingUntil).toBeNull();
    expect(enDb.breakingSince).toBeNull();
  });
});
