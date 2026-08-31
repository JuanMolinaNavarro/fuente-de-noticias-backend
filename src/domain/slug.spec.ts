import { slugify } from './slug';

describe('slugify', () => {
  it('convierte a minúsculas y reemplaza espacios por guiones', () => {
    expect(slugify('Hola Mundo')).toBe('hola-mundo');
  });

  it('elimina tildes y diéresis', () => {
    expect(slugify('Tucumán, güemes y ñandú')).toBe('tucuman-guemes-y-nandu');
  });

  it('descarta símbolos y colapsa separadores', () => {
    expect(slugify('¿Qué pasó?! -- ayer')).toBe('que-paso-ayer');
  });

  it('recorta a 80 caracteres', () => {
    expect(slugify('a'.repeat(120)).length).toBeLessThanOrEqual(80);
  });
});
