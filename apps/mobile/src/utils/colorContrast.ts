/** Contraste texte sur tuile produit (parité desktop PosPage). */
export function textColorForBackground(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#0f172a';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}

export const DEFAULT_PRODUCT_TILE_COLOR = '#f8fafc';
