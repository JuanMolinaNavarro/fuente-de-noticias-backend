import { mapearCategoria } from './categorizer';
import { parseFeedsConfig } from './feeds-config';
import { stripHtml } from './html';
import { materialDeFuente } from './ingest.service';

describe('parseFeedsConfig', () => {
  it('parsea entradas "url" y "url|Categoría"', () => {
    expect(
      parseFeedsConfig('https://a.com/rss, https://b.com/rss|Deportes'),
    ).toEqual([
      { url: 'https://a.com/rss', category: null },
      { url: 'https://b.com/rss', category: 'Deportes' },
    ]);
  });

  it('devuelve vacío sin config', () => {
    expect(parseFeedsConfig(undefined)).toEqual([]);
    expect(parseFeedsConfig('')).toEqual([]);
  });
});

describe('mapearCategoria', () => {
  it('matchea por palabra clave, primera regla gana', () => {
    expect(mapearCategoria(['Fútbol de primera'])).toBe('Deportes');
    expect(mapearCategoria(['Noticias del NOA'])).toBe('Tucumán');
    expect(mapearCategoria(['dólar blue'])).toBe('Economía');
  });

  it('devuelve null si nada matchea', () => {
    expect(mapearCategoria(['sin categoría clara'])).toBeNull();
    expect(mapearCategoria([])).toBeNull();
  });
});

describe('stripHtml', () => {
  it('quita tags y decodifica entidades', () => {
    expect(stripHtml('<p>Hola &amp; chau</p>')).toBe('Hola & chau');
  });

  it('colapsa espacios', () => {
    expect(stripHtml('a\n\n  b')).toBe('a b');
  });
});

describe('materialDeFuente', () => {
  it('copia el material y trunca el summary a 220', () => {
    const largo = 'x'.repeat(300);
    const r = materialDeFuente({
      originalTitle: 'Título',
      originalContent: largo,
    });
    expect(r.title).toBe('Título');
    expect(r.content).toBe(largo);
    expect(r.summary.length).toBeLessThanOrEqual(220);
    expect(r.summary.endsWith('…')).toBe(true);
  });

  it('usa el título como material si el feed no trajo cuerpo', () => {
    const r = materialDeFuente({
      originalTitle: 'Solo título',
      originalContent: '',
    });
    expect(r.content).toBe('Solo título');
  });
});
