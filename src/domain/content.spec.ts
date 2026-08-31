import { docToPlainText, parseDoc, plainTextToDoc, wordCount } from './content';

describe('plainTextToDoc', () => {
  it('convierte párrafos separados por doble salto; los simples son hardBreak', () => {
    const doc = plainTextToDoc('Primero.\n\nSegundo\nlínea dos.\n\n\n');
    expect(doc).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Primero.' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Segundo' },
            { type: 'hardBreak' },
            { type: 'text', text: 'línea dos.' },
          ],
        },
      ],
    });
  });

  it('texto vacío o null -> doc vacío', () => {
    expect(plainTextToDoc(null).content).toEqual([]);
    expect(plainTextToDoc('   ').content).toEqual([]);
  });
});

describe('docToPlainText', () => {
  it('es la inversa de plainTextToDoc para párrafos', () => {
    const text = 'Uno.\n\nDos y\ntres.';
    expect(docToPlainText(plainTextToDoc(text))).toBe(text);
  });

  it('aplana títulos, citas y listas', () => {
    const doc = parseDoc({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Sub' }],
        },
        {
          type: 'blockquote',
          attrs: { attribution: 'Alguien' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Cita.' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'c' }] },
              ],
            },
          ],
        },
        { type: 'paragraph' },
      ],
    });
    expect(docToPlainText(doc)).toBe(
      'Sub\n\nCita.\n— Alguien\n\n• a\n• b\n\n3. c',
    );
  });
});

describe('DocSchema (parseDoc)', () => {
  it('acepta marcas bold/italic/link http(s) y descarta claves desconocidas', () => {
    const doc = parseDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                { type: 'bold' },
                {
                  type: 'link',
                  attrs: {
                    href: 'https://ok.com',
                    target: '_blank',
                    onclick: 'evil()',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const mark =
      doc.content[0].type === 'paragraph' &&
      doc.content[0].content?.[0].type === 'text'
        ? doc.content[0].content[0].marks?.[1]
        : undefined;
    expect(mark).toEqual({
      type: 'link',
      attrs: { href: 'https://ok.com', target: '_blank' },
    });
  });

  it('rechaza nodos fuera de la lista blanca y links no http', () => {
    expect(() =>
      parseDoc({
        type: 'doc',
        content: [{ type: 'iframe', attrs: { src: 'x' } }],
      }),
    ).toThrow();
    expect(() =>
      parseDoc({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseDoc({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 1 } }],
      }),
    ).toThrow();
  });
});

describe('wordCount', () => {
  it('cuenta palabras', () => {
    expect(wordCount('  hola   mundo\ncruel ')).toBe(3);
    expect(wordCount(null)).toBe(0);
  });
});

describe('plainTextToDoc con CRLF (formularios HTML)', () => {
  it('parte párrafos aunque los saltos sean \r\n', () => {
    const doc = plainTextToDoc('Uno.\r\n\r\nDos.\r\nTres.');
    expect(doc.content).toHaveLength(2);
    expect(docToPlainText(doc)).toBe('Uno.\n\nDos.\nTres.');
  });
});
