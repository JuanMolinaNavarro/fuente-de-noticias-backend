export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      // elimina diacríticos combinantes (tildes, diéresis, virgulilla)
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  );
}
