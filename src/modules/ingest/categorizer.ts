/**
 * Mapea las categorías del feed (o palabras clave) a las categorías de marca.
 * Función pura. En la Fase 3, las reglas pueden pasar a la tabla Category.
 */
const MAPA_CATEGORIAS: [RegExp, string][] = [
  [/tucum|noa\b/i, 'Tucumán'],
  [/campo|rural|agro|azucar|azúcar|limon|limón|cosecha|zafra/i, 'Campo'],
  [/politic|elecci|gobierno|congreso|senado|diputad/i, 'Política'],
  [/policial|inseguridad|narco|crimen|justicia|tribunal/i, 'Policial'],
  [/econom|dolar|dólar|inflaci|mercado|finanz/i, 'Economía'],
  [/deport|futbol|fútbol|river|boca|seleccion|liga|tenis|basquet/i, 'Deportes'],
  [
    /cultura|espectacul|cine|music|música|teatro|arte|celebrit|famos/i,
    'Cultura',
  ],
  [
    /internacional|mundo\b|ee\.?uu|estados unidos|europa|brasil|chile\b/i,
    'Internacional',
  ],
  [/tecnolog|inteligencia artificial|ciberseg|software|gadget/i, 'Tecnología'],
  [/sociedad|educacion|educación|salud|universidad/i, 'Sociedad'],
];

export function mapearCategoria(valores: string[]): string | null {
  for (const v of valores) {
    for (const [re, cat] of MAPA_CATEGORIAS) {
      if (re.test(v)) return cat;
    }
  }
  return null;
}
