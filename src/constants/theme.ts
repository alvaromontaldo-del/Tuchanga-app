import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

/**
 * Sistema de diseño Tu Changa (tokens).
 * Fondo de app gris muy claro; tarjetas blancas; radios y sombras unificados.
 */
// Mat del logo: debe ser idéntico al fondo general para evitar contraste visible.
export const brandLogoMat = '#EBEBEB' as const;

export const colors = {
  primary: '#C62828',
  primaryDark: '#8E0000',
  /** Lienzo principal de la app */
  // Nota: el logo horizontal actual tiene fondo gris no-transparente; mantenemos el mismo tono para evitar contraste.
  background: '#EBEBEB',
  brandLogoMat,
  /** Tarjetas y superficies elevadas */
  surface: '#FFFFFF',
  text: '#1A1A1A',
  textSecondary: '#6B6B6B',
  border: '#E0E0E0',
  error: '#B71C1C',
  overlay: 'rgba(0,0,0,0.45)',
  /** Miniaturas / placeholders de imagen */
  imagePlaceholder: '#E8EAEF',
} as const;

export const radii = {
  /** Contenedores principales: tarjetas, bloques */
  card: 12,
  /** Inputs, chips */
  input: 12,
  button: 20,
  /** Thumbnails en listas (ChangaCard) */
  thumb: 8,
} as const;

/** Tipografía global (título / subtítulo / cuerpo) */
export const typography = {
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  } satisfies TextStyle,
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  } satisfies TextStyle,
  body: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text,
    lineHeight: 20,
  } satisfies TextStyle,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

/** Sombras: Android elevation 3; iOS sombra suave */
export const shadows = {
  card: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 5,
    },
    android: { elevation: 3 },
    default: {},
  }),
} as const;

/** Cabecera nativa y lienzo de stack */
export const stackChrome = {
  headerStyle: { backgroundColor: colors.surface },
  contentStyle: { backgroundColor: colors.background },
} as const;

/**
 * Base estática (sin inset de status bar). En pantallas con header nativo preferí
 * `useNativeStackScreenOptions()` desde `src/navigation/useNativeStackScreenOptions.ts`.
 */
export const nativeStackScreenOptions: NativeStackNavigationOptions = {
  headerStyle: stackChrome.headerStyle,
  headerShadowVisible: false,
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: stackChrome.contentStyle,
  headerBackTitleVisible: false,
  headerBackButtonDisplayMode: 'minimal',
};
