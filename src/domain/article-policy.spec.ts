import { assertCan, can, ForbiddenError } from './article-policy';

const admin = { id: 'a', role: 'ADMIN' as const };
const editor = { id: 'e', role: 'EDITOR' as const };
const redactor = { id: 'r', role: 'REDACTOR' as const };

const mine = { status: 'DRAFT', createdById: 'r' };
const mineInReview = { status: 'IN_REVIEW', createdById: 'r' };
const other = { status: 'DRAFT', createdById: 'x' };
const fromFeed = { status: 'DRAFT', createdById: null };

describe('article-policy', () => {
  it('ADMIN y EDITOR pueden todo', () => {
    for (const actor of [admin, editor]) {
      expect(can('publish', actor, other)).toBe(true);
      expect(can('edit', actor, fromFeed)).toBe(true);
      expect(
        can('restore', actor, { status: 'SPIKED', createdById: 'x' }),
      ).toBe(true);
    }
  });

  it('REDACTOR: crea y ve, pero no publica ni devuelve ni despublica', () => {
    expect(can('create', redactor)).toBe(true);
    expect(can('view', redactor, other)).toBe(true);
    expect(can('publish', redactor, mine)).toBe(false);
    expect(can('return', redactor, mine)).toBe(false);
    expect(can('unpublish', redactor, mine)).toBe(false);
    expect(
      can('restore', redactor, { status: 'SPIKED', createdById: 'r' }),
    ).toBe(false);
  });

  it('REDACTOR: edita/envía/descarta sólo lo propio en DRAFT', () => {
    expect(can('edit', redactor, mine)).toBe(true);
    expect(can('submit', redactor, mine)).toBe(true);
    expect(can('spike', redactor, mine)).toBe(true);
    expect(can('restoreRevision', redactor, mine)).toBe(true);

    expect(can('edit', redactor, other)).toBe(false);
    expect(can('edit', redactor, fromFeed)).toBe(false); // sin dueño = de la mesa de editores
    expect(can('edit', redactor, mineInReview)).toBe(false); // ya no está en sus manos
  });

  it('assertCan lanza ForbiddenError con mensaje legible', () => {
    expect(() => assertCan('publish', redactor, mine)).toThrow(ForbiddenError);
    expect(() => assertCan('publish', redactor, mine)).toThrow(/publicar/);
    expect(() => assertCan('edit', editor, other)).not.toThrow();
  });
});
