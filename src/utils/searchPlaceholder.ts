/** Frase completa del buscador de profesionales. Sin puntos suspensivos. */
export const SEARCH_PLACEHOLDER = 'Buscar profesionales u oficios';

/**
 * Ancho de {@link SEARCH_PLACEHOLDER} con fontWeight 600, dividido por el fontSize.
 * Medido con Noto Sans Bold (Android sintetiza 600 como negrita; en iOS el sistema es más angosto).
 */
export const SEARCH_PLACEHOLDER_EM = 14.85;

export const SEARCH_PLACEHOLDER_MAX_FONT = 15;
export const SEARCH_PLACEHOLDER_MIN_FONT = 9.5;

/**
 * Medidas de la barra. El botón «Filtros» se queda; el hueco del texto es lo que sobra.
 * `filterLabelWidth` es «Filtros» a 13 px en negrita, redondeado hacia arriba.
 */
export const searchHeaderLayout = {
  shellPaddingH: 24,
  searchPaddingH: 8,
  searchGap: 6,
  searchIcon: 18,
  filterPadH: 8,
  filterIcon: 16,
  filterGap: 4,
  filterLabelWidth: 42,
} as const;

/** Ancho útil del texto, en px lógicos, con el botón «Filtros» a la derecha. */
export function searchPlaceholderSlotWidth(screenWidth: number): number {
  const m = searchHeaderLayout;
  const chrome =
    m.shellPaddingH * 2 +
    m.searchPaddingH * 2 +
    m.searchIcon +
    m.searchGap * 2 +
    m.filterPadH * 2 +
    m.filterIcon +
    m.filterGap +
    m.filterLabelWidth;
  return screenWidth - chrome;
}

/**
 * Tamaño de letra para que `text` entre en `availableWidth` sin recorte.
 * Antes de medir el hueco devuelve el máximo: `adjustsFontSizeToFit` cubre ese frame.
 */
export function searchPlaceholderFontSize(
  availableWidth: number,
  text: string = SEARCH_PLACEHOLDER,
): number {
  const max = SEARCH_PLACEHOLDER_MAX_FONT;
  const min = SEARCH_PLACEHOLDER_MIN_FONT;
  if (!(availableWidth > 0) || text.length === 0) return max;
  const em = (SEARCH_PLACEHOLDER_EM * text.length) / SEARCH_PLACEHOLDER.length;
  const fitted = (availableWidth - 1) / em;
  const stepped = Math.floor(fitted * 2) / 2;
  return Math.min(max, Math.max(min, stepped));
}
