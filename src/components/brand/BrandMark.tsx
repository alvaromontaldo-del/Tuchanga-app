import { Image, type ImageStyle, type StyleProp, useWindowDimensions } from 'react-native';

/** Logo horizontal oficial (PNG con wordmark). */
export const brandLogoHorizontal = require('../../../assets/brand/logo-yachanga-v22_bold_tracking1.png');

/** Ratio ancho / alto del arte en `logo-official-horizontal.png`. */
export const BRAND_HORIZONTAL_ASPECT = 1024 / 431;

/**
 * Tamaños del logo en función del ancho de ventana (y tope para tablets).
 * `contain` mantiene proporción; altura deriva del ancho y del aspect ratio real.
 */
export function getBrandLogoLayout(
  variant: 'header' | 'hero' | 'compact',
  windowWidth: number,
): { width: number; height: number } {
  const capW = Math.min(windowWidth, 560);

  switch (variant) {
    case 'hero': {
      const w = Math.min(280, Math.round(capW * 0.78));
      const h = Math.round(Math.min(58, w / BRAND_HORIZONTAL_ASPECT));
      return { width: w, height: Math.max(h, 36) };
    }
    case 'header': {
      const w = Math.min(224, Math.round(capW * 0.56));
      const h = Math.round(Math.min(40, w / BRAND_HORIZONTAL_ASPECT));
      return { width: w, height: Math.max(h, 28) };
    }
    case 'compact': {
      const reserve = 96;
      const w = Math.min(
        172,
        Math.round(Math.max(windowWidth - reserve, 160) * 0.48),
      );
      const h = Math.round(Math.min(32, w / BRAND_HORIZONTAL_ASPECT));
      return { width: Math.max(w, 112), height: Math.max(h, 22) };
    }
  }
}

type BrandLogoHorizontalProps = {
  variant?: 'header' | 'hero' | 'compact';
  /** Limita el ancho (p. ej. ancho de la tarjeta en login). */
  maxWidth?: number;
  style?: StyleProp<ImageStyle>;
};

/**
 * Marca Tu Changa (logo horizontal). `resizeMode="contain"` evita recortes.
 */
export function BrandLogoHorizontal({
  variant = 'header',
  maxWidth,
  style,
}: BrandLogoHorizontalProps) {
  const { width: windowWidth } = useWindowDimensions();
  const capW = Math.min(windowWidth, 560);

  let width: number;
  let height: number;

  if (variant === 'hero' && maxWidth != null) {
    /** Hasta el ancho del contenedor (p. ej. tarjeta de login), sin desproporcionar en tablets. */
    width = Math.round(Math.min(maxWidth, 420, capW * 0.94));
    height = Math.round(Math.max(width / BRAND_HORIZONTAL_ASPECT, 36));
  } else {
    ({ width, height } = getBrandLogoLayout(variant, windowWidth));
    if (maxWidth != null && width > maxWidth) {
      width = maxWidth;
      height = Math.round(Math.max(width / BRAND_HORIZONTAL_ASPECT, 22));
    }
  }

  return (
    <Image
      source={brandLogoHorizontal}
      accessibilityLabel="Tu Changa"
      resizeMode="contain"
      style={[{ width, height }, style]}
    />
  );
}

/** Para `headerTitle` de React Navigation (barra con logo compacto). */
export function BrandNavigationHeaderTitle() {
  return <BrandLogoHorizontal variant="compact" />;
}
