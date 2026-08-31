/**
 * Contrato del cuerpo de la nota — lógica de dominio pura.
 *
 * El cuerpo se guarda como documento ProseMirror/Tiptap (JSON) en
 * Article.contentJson: es la fuente de verdad. De él se DERIVA el texto plano
 * (Article.content) para búsqueda y similaridad con la fuente.
 *
 * DocSchema es la lista blanca de nodos y marcas que aceptamos (versión 1).
 * Validar acá y no confiar en el editor tiene dos motivos:
 *  1. Seguridad: el frontend renderiza el JSON con componentes React (nunca
 *     dangerouslySetInnerHTML), así que cualquier nodo que no esté en esta
 *     lista simplemente no existe para el sistema.
 *  2. Compatibilidad: si mañana el editor agrega un nodo, el backend lo
 *     rechaza con 400 hasta que lo soportemos de punta a punta.
 * Se guarda el resultado de `parse` (zod descarta las claves desconocidas).
 */
import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Sólo se admiten links http(s)');

const MarkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: httpUrl,
      target: z.string().optional().nullable(),
      rel: z.string().optional().nullable(),
    }),
  }),
]);

const TextSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(MarkSchema).optional(),
});

const HardBreakSchema = z.object({ type: z.literal('hardBreak') });

const InlineSchema = z.union([TextSchema, HardBreakSchema]);

const ParagraphSchema = z.object({
  type: z.literal('paragraph'),
  content: z.array(InlineSchema).optional(),
});

const HeadingSchema = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: z.array(InlineSchema).optional(),
});

const BlockquoteSchema = z.object({
  type: z.literal('blockquote'),
  // "attribution" es nuestro: a quién se atribuye la cita
  attrs: z.object({ attribution: z.string().nullable().optional() }).optional(),
  content: z.array(ParagraphSchema).min(1),
});

const ListItemSchema = z.object({
  type: z.literal('listItem'),
  content: z.array(ParagraphSchema).min(1),
});

const BulletListSchema = z.object({
  type: z.literal('bulletList'),
  content: z.array(ListItemSchema).min(1),
});

const OrderedListSchema = z.object({
  type: z.literal('orderedList'),
  attrs: z.object({ start: z.number().int().optional() }).optional(),
  content: z.array(ListItemSchema).min(1),
});

/** Imagen dentro del cuerpo: referencia a la biblioteca + metadatos editoriales
 *  (el epígrafe puede diferir del de la biblioteca: la misma foto ilustra
 *  cosas distintas en notas distintas). */
const ImageSchema = z.object({
  type: z.literal('image'),
  attrs: z.object({
    mediaId: z.string().nullable().optional(),
    src: httpUrl,
    alt: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    credit: z.string().nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
  }),
});

const BlockSchema = z.discriminatedUnion('type', [
  ParagraphSchema,
  HeadingSchema,
  BlockquoteSchema,
  BulletListSchema,
  OrderedListSchema,
  ImageSchema,
]);

export const DocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(BlockSchema),
});

export type Doc = z.infer<typeof DocSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type Inline = z.infer<typeof InlineSchema>;

/** Valida un documento arbitrario; lanza ZodError si no cumple el contrato. */
export function parseDoc(input: unknown): Doc {
  return DocSchema.parse(input);
}

/* ── texto plano -> doc ─────────────────────────────────────────────── */

/**
 * Convierte el texto plano heredado (párrafos separados por doble salto de
 * línea, que es exactamente lo que el sitio renderizaba con split(/\n{2,}/))
 * en un documento de párrafos. Los saltos simples quedan como hardBreak.
 */
export function plainTextToDoc(text: string | null | undefined): Doc {
  const paragraphs = (text ?? '')
    // Los formularios HTML y Windows mandan CRLF: normalizamos antes de partir
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    type: 'doc',
    content: paragraphs.map((p) => {
      const lines = p.split('\n');
      const content: Inline[] = [];
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        if (line.length) content.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content };
    }),
  };
}

/* ── doc -> texto plano ─────────────────────────────────────────────── */

function inlineText(nodes: Inline[] | undefined): string {
  if (!nodes) return '';
  return nodes.map((n) => (n.type === 'text' ? n.text : '\n')).join('');
}

function blockText(block: Block): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(block.content);
    case 'blockquote': {
      const body = block.content.map((p) => inlineText(p.content)).join('\n');
      const who = block.attrs?.attribution;
      return who ? `${body}\n— ${who}` : body;
    }
    case 'bulletList':
      return block.content
        .map(
          (li) =>
            `• ${li.content.map((p) => inlineText(p.content)).join('\n')}`,
        )
        .join('\n');
    case 'image':
      // El texto derivado (búsqueda/similaridad) no lleva la imagen;
      // el epígrafe sí, porque es texto de la nota.
      return block.attrs.caption ? `[Foto: ${block.attrs.caption}]` : '';
    case 'orderedList': {
      const start = block.attrs?.start ?? 1;
      return block.content
        .map(
          (li, i) =>
            `${start + i}. ${li.content.map((p) => inlineText(p.content)).join('\n')}`,
        )
        .join('\n');
    }
  }
}

/** Texto plano derivado: bloques separados por doble salto de línea. */
export function docToPlainText(doc: Doc | null | undefined): string {
  if (!doc) return '';
  return doc.content
    .map(blockText)
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Cantidad de palabras del cuerpo (para el contador del editor y stats). */
export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}
