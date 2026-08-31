/**
 * Política de permisos sobre artículos — lógica de dominio pura.
 *
 * Responde "¿puede ESTE actor hacer ESTA acción sobre ESTA nota?". Va acá y
 * no en un guard de Nest porque la respuesta depende de datos de la fila
 * (quién la creó, en qué estado está) que sólo se conocen después de leerla
 * de la base. Los `@Roles(...)` del controller filtran lo grueso (un REDACTOR
 * nunca llega a /publish); esta función decide lo fino (un REDACTOR sólo edita
 * SUS borradores).
 *
 *   ADMIN / EDITOR -> todo
 *   REDACTOR       -> crear; ver cualquiera; editar/enviar/descartar/
 *                     restaurar revisión sólo en notas PROPIAS en DRAFT
 */
export type Role = 'ADMIN' | 'EDITOR' | 'REDACTOR';

export type ArticleAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'submit'
  | 'return'
  | 'publish'
  | 'unschedule'
  | 'unpublish'
  | 'spike'
  | 'restore'
  | 'restoreRevision'
  | 'preview';

export interface Actor {
  id: string;
  role: Role;
}

export interface OwnedArticle {
  status: string;
  createdById: string | null;
}

export class ForbiddenError extends Error {
  constructor(action: ArticleAction) {
    super(`No tenés permiso para ${describe(action)}`);
    this.name = 'ForbiddenError';
  }
}

const LABELS: Record<ArticleAction, string> = {
  view: 'ver esta nota',
  create: 'crear notas',
  edit: 'editar esta nota',
  submit: 'enviar esta nota a revisión',
  return: 'devolver notas',
  publish: 'publicar notas',
  unschedule: 'desprogramar notas',
  unpublish: 'despublicar notas',
  spike: 'descartar esta nota',
  restore: 'restaurar notas descartadas',
  restoreRevision: 'restaurar versiones de esta nota',
  preview: 'generar una vista previa de esta nota',
};

function describe(action: ArticleAction) {
  return LABELS[action];
}

/** Acciones que un REDACTOR puede hacer sobre un borrador propio. */
const OWN_DRAFT_ACTIONS: ReadonlySet<ArticleAction> = new Set([
  'edit',
  'submit',
  'spike',
  'restoreRevision',
]);

export function can(
  action: ArticleAction,
  actor: Actor,
  article?: OwnedArticle,
): boolean {
  if (actor.role === 'ADMIN' || actor.role === 'EDITOR') return true;

  // REDACTOR
  if (action === 'create' || action === 'view') return true;
  if (!article) return false;
  // Vista previa: el enlace resultante es PÚBLICO (cualquiera con la URL ve
  // la nota sin login), así que un redactor sólo puede generarlo para las
  // notas propias — no para borradores ajenos ni notas despublicadas.
  if (action === 'preview') return article.createdById === actor.id;
  if (!OWN_DRAFT_ACTIONS.has(action)) return false;
  return article.createdById === actor.id && article.status === 'DRAFT';
}

export function assertCan(
  action: ArticleAction,
  actor: Actor,
  article?: OwnedArticle,
): void {
  if (!can(action, actor, article)) throw new ForbiddenError(action);
}
