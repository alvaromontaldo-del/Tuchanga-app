import { useMemo } from 'react';
import { Platform } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { colors, stackChrome } from '../constants/theme';
import { androidNativeStackHeaderOptions } from './NativeStackSafeHeader';

/**
 * Opciones globales del native stack (cabecera con safe area en Android).
 * Usar en `screenOptions={useNativeStackScreenOptions()}` dentro de cada Navigator.
 */
export function useNativeStackScreenOptions(
  overrides?: NativeStackNavigationOptions,
): NativeStackNavigationOptions {
  return useMemo(() => {
    const base: NativeStackNavigationOptions = {
      headerStyle: stackChrome.headerStyle,
      headerShadowVisible: false,
      headerTintColor: colors.text,
      headerTitleStyle: { fontWeight: '700' },
      contentStyle: stackChrome.contentStyle,
      headerBackTitleVisible: false,
      headerBackButtonDisplayMode: 'minimal',
      ...(Platform.OS === 'android' ? androidNativeStackHeaderOptions : {}),
      ...overrides,
    };

    return base;
  }, [overrides]);
}

/** Combina capas de opciones (p. ej. stack global + pantalla concreta). */
export function mergeNativeStackScreenOptions(
  ...layers: Array<NativeStackNavigationOptions | undefined>
): NativeStackNavigationOptions {
  return layers.reduce<NativeStackNavigationOptions>(
    (acc, layer) => (layer ? { ...acc, ...layer } : acc),
    {},
  );
}
