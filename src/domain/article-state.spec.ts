import {
  buildSlug,
  createOriginal,
  draftFromFeed,
  IncompleteArticleError,
  InvalidTransitionError,
  publishArticle,
  PublishableArticle,
  releaseScheduled,
  restoreArticle,
  returnArticle,
  spikeArticle,
  submitArticle,
  unpublishArticle,
  unscheduleArticle,
} from './article-state';

const NOW = new Date('2026-08-18T12:00:00Z');
const REVIEWER = 'editor-1';
const OPTS = {};

const publishable = (
  over: Partial<PublishableArticle> = {},
): PublishableArticle => ({
  id: 'clx123abcdef',
  status: 'DRAFT',
  origin: 'ORIGINAL',
  slug: null,
  title: 'Título de prueba',
  content: 'Cuerpo de la nota',
  categoryId: 'cat-1',
  sourceSimilarity: null,
  firstPublishedAt: null,
  ...over,
});

describe('createOriginal', () => {
  it('nace en DRAFT, ORIGINAL, con dueño y sin fuente', () => {
    const r = createOriginal({ title: '  Hola  ' }, 'redactor-1', NOW);
    expect(r).toMatchObject({
      origin: 'ORIGINAL',
      status: 'DRAFT',
      title: 'Hola',
      createdById: 'redactor-1',
      lastEditedById: 'redactor-1',
    });
  });

  it('exige título', () => {
    expect(() => createOriginal({ title: '   ' }, 'r', NOW)).toThrow(
      IncompleteArticleError,
    );
  });
});

describe('draftFromFeed', () => {
  const material = { title: 'T', summary: 'S', content: 'C' };

  it('INGESTED -> DRAFT con el material del feed', () => {
    const r = draftFromFeed({ status: 'INGESTED' }, material);
    expect(r).toMatchObject({
      status: 'DRAFT',
      title: 'T',
      summary: 'S',
      content: 'C',
    });
  });

  it('sólo desde INGESTED', () => {
    expect(() => draftFromFeed({ status: 'DRAFT' }, material)).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('submitArticle', () => {
  it('DRAFT -> IN_REVIEW y limpia la nota de devolución anterior', () => {
    const r = submitArticle(
      { status: 'DRAFT', title: 'T', content: 'C' },
      'redactor-1',
      NOW,
    );
    expect(r).toMatchObject({ status: 'IN_REVIEW', reviewNote: null });
  });

  it('exige título y cuerpo (lista de faltantes)', () => {
    try {
      submitArticle({ status: 'DRAFT', title: null, content: '' }, 'r', NOW);
      fail('debía lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(IncompleteArticleError);
      expect((e as IncompleteArticleError).missing).toEqual([
        'title',
        'content',
      ]);
    }
  });

  it('sólo desde DRAFT', () => {
    expect(() =>
      submitArticle(
        { status: 'IN_REVIEW', title: 'T', content: 'C' },
        'r',
        NOW,
      ),
    ).toThrow(InvalidTransitionError);
  });
});

describe('returnArticle', () => {
  it('IN_REVIEW -> DRAFT con nota obligatoria', () => {
    const r = returnArticle(
      { status: 'IN_REVIEW' },
      ' Falta la fuente ',
      REVIEWER,
      NOW,
    );
    expect(r).toEqual({
      status: 'DRAFT',
      reviewNote: 'Falta la fuente',
      reviewedAt: NOW,
      reviewedById: REVIEWER,
    });
    expect(() =>
      returnArticle({ status: 'IN_REVIEW' }, '  ', REVIEWER, NOW),
    ).toThrow(IncompleteArticleError);
    expect(() =>
      returnArticle({ status: 'DRAFT' }, 'x', REVIEWER, NOW),
    ).toThrow(InvalidTransitionError);
  });
});

describe('publishArticle', () => {
  it('publica un DRAFT: genera slug, sella fechas y revisor', () => {
    const r = publishArticle(publishable(), REVIEWER, NOW, OPTS);
    expect(r).toMatchObject({
      status: 'PUBLISHED',
      slug: 'titulo-de-prueba-abcdef',
      publishedAt: NOW,
      firstPublishedAt: NOW,
      scheduledAt: null,
      reviewedAt: NOW,
      reviewedById: REVIEWER,
    });
  });

  it('publica desde IN_REVIEW e INGESTED', () => {
    expect(
      publishArticle(publishable({ status: 'IN_REVIEW' }), REVIEWER, NOW, OPTS)
        .status,
    ).toBe('PUBLISHED');
    expect(
      publishArticle(publishable({ status: 'INGESTED' }), REVIEWER, NOW, OPTS)
        .status,
    ).toBe('PUBLISHED');
  });

  it('conserva el slug y firstPublishedAt si ya existían (republicar)', () => {
    const first = new Date('2026-01-01T00:00:00Z');
    const r = publishArticle(
      publishable({
        slug: 'viejo-slug-abcdef',
        firstPublishedAt: first,
        title: 'Otro título',
      }),
      REVIEWER,
      NOW,
      OPTS,
    );
    expect(r).toMatchObject({
      slug: 'viejo-slug-abcdef',
      firstPublishedAt: first,
      publishedAt: NOW,
    });
  });

  it('reglas bloqueantes: título, cuerpo y sección', () => {
    try {
      publishArticle(
        publishable({ title: '', content: null, categoryId: null }),
        REVIEWER,
        NOW,
        OPTS,
      );
      fail('debía lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(IncompleteArticleError);
      expect((e as IncompleteArticleError).missing).toEqual([
        'title',
        'content',
        'categoryId',
      ]);
    }
  });

  it('la similaridad con la fuente no bloquea la publicación', () => {
    // La similaridad se mide y se muestra como advertencia, pero publicar
    // es decisión del editor: incluso una nota de feed casi calcada publica.
    expect(
      publishArticle(
        publishable({ origin: 'FEED', sourceSimilarity: 0.9 }),
        REVIEWER,
        NOW,
        OPTS,
      ).status,
    ).toBe('PUBLISHED');
    expect(
      publishArticle(
        publishable({ origin: 'ORIGINAL', sourceSimilarity: 0.9 }),
        REVIEWER,
        NOW,
        OPTS,
      ).status,
    ).toBe('PUBLISHED');
  });

  it('con scheduledAt futuro queda SCHEDULED (con slug ya reservado)', () => {
    const later = new Date('2026-08-19T08:00:00Z');
    const r = publishArticle(publishable(), REVIEWER, NOW, {
      ...OPTS,
      scheduledAt: later,
    });
    expect(r).toMatchObject({
      status: 'SCHEDULED',
      scheduledAt: later,
      publishedAt: null,
      slug: 'titulo-de-prueba-abcdef',
    });
  });

  it('con scheduledAt pasado publica ya', () => {
    const before = new Date('2026-08-18T11:00:00Z');
    const r = publishArticle(publishable(), REVIEWER, NOW, {
      ...OPTS,
      scheduledAt: before,
    });
    expect(r.status).toBe('PUBLISHED');
  });

  it('no permite publicar algo PUBLISHED, SCHEDULED o SPIKED', () => {
    for (const status of ['PUBLISHED', 'SCHEDULED', 'SPIKED'] as const) {
      expect(() =>
        publishArticle(publishable({ status }), REVIEWER, NOW, OPTS),
      ).toThrow(InvalidTransitionError);
    }
  });

  it('slugifica títulos con tildes y símbolos', () => {
    expect(buildSlug('¡Economía en acción! ¿Qué pasó?', 'clx123abcdef')).toBe(
      'economia-en-accion-que-paso-abcdef',
    );
  });
});

describe('releaseScheduled', () => {
  it('SCHEDULED -> PUBLISHED con la fecha programada como publishedAt', () => {
    const at = new Date('2026-08-18T11:59:00Z');
    const r = releaseScheduled(
      { status: 'SCHEDULED', scheduledAt: at, firstPublishedAt: null },
      NOW,
    );
    expect(r).toEqual({
      status: 'PUBLISHED',
      publishedAt: at,
      firstPublishedAt: at,
      scheduledAt: null,
    });
  });

  it('no libera antes de hora ni desde otro estado', () => {
    const later = new Date('2026-08-19T00:00:00Z');
    expect(() =>
      releaseScheduled(
        { status: 'SCHEDULED', scheduledAt: later, firstPublishedAt: null },
        NOW,
      ),
    ).toThrow(/hora/);
    expect(() =>
      releaseScheduled(
        { status: 'DRAFT', scheduledAt: NOW, firstPublishedAt: null },
        NOW,
      ),
    ).toThrow(InvalidTransitionError);
  });
});

describe('unscheduleArticle', () => {
  it('SCHEDULED -> DRAFT', () => {
    expect(unscheduleArticle({ status: 'SCHEDULED' }, REVIEWER, NOW)).toEqual({
      status: 'DRAFT',
      scheduledAt: null,
      reviewedAt: NOW,
      reviewedById: REVIEWER,
    });
    expect(() => unscheduleArticle({ status: 'DRAFT' }, REVIEWER, NOW)).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('unpublishArticle', () => {
  it('despublica: vuelve a DRAFT y CONSERVA el slug', () => {
    const r = unpublishArticle({ status: 'PUBLISHED' }, REVIEWER, NOW);
    expect(r).toEqual({
      status: 'DRAFT',
      publishedAt: null,
      reviewedAt: NOW,
      reviewedById: REVIEWER,
    });
    expect('slug' in r).toBe(false);
  });

  it('solo se puede despublicar algo PUBLISHED', () => {
    expect(() => unpublishArticle({ status: 'DRAFT' }, REVIEWER, NOW)).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('spikeArticle / restoreArticle', () => {
  it('descarta desde INGESTED, DRAFT o IN_REVIEW; nunca desde PUBLISHED', () => {
    for (const status of ['INGESTED', 'DRAFT', 'IN_REVIEW'] as const) {
      expect(spikeArticle({ status }, REVIEWER, NOW).status).toBe('SPIKED');
    }
    expect(() => spikeArticle({ status: 'PUBLISHED' }, REVIEWER, NOW)).toThrow(
      InvalidTransitionError,
    );
    expect(() => spikeArticle({ status: 'SPIKED' }, REVIEWER, NOW)).toThrow(
      InvalidTransitionError,
    );
  });

  it('restaura SPIKED -> DRAFT', () => {
    expect(restoreArticle({ status: 'SPIKED' }, REVIEWER, NOW).status).toBe(
      'DRAFT',
    );
    expect(() => restoreArticle({ status: 'DRAFT' }, REVIEWER, NOW)).toThrow(
      InvalidTransitionError,
    );
  });
});
