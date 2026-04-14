/**
 * Paleta Tu Changa: rojo de marca, grises y negro.
 *
 * `brandLogoMat` / `background`: gris del lienzo del PNG horizontal oficial (~RGB 235).
 * Unifica pantallas y splash para que no se vea un recuadro distinto alrededor del logo.
 */
export const brandLogoMat = '#EBEBEB' as const;

export const colors = {
  primary: '#C62828',
  primaryDark: '#8E0000',
  background: brandLogoMat,
  /** Mismo tono que `background`; útil en cabeceras nativas con el logo. */
  brandLogoMat,
  surface: '#FFFFFF',
  text: '#1A1A1A',
  textSecondary: '#6B6B6B',
  border: '#E0E0E0',
  error: '#B71C1C',
  overlay: 'rgba(0,0,0,0.45)',
} as const;

export const radii = {
  /** Bordes muy redondeados estilo Apple */
  input: 18,
  button: 20,
  card: 16,
} as const;

export const spacing = {
  xs: 6,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** Cabecera nativa y lienzo de stack (Feed, Buscar, Mensajes) — alineado con Perfil. */
export const stackChrome = {
  headerStyle: { backgroundColor: colors.surface },
  contentStyle: { backgroundColor: colors.background },
} as const;
