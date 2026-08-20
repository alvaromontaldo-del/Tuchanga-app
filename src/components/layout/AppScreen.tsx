import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
  type Edge,
} from 'react-native-safe-area-context';
import { resolveTopSafeInset } from '../../utils/resolveSafeAreaInsets';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Por defecto: laterales + inferior. Pasá `'top'` si la pantalla tiene barra propia (sin header del stack). */
  edges?: Edge[];
};

/**
 * Contenedor de pantalla con safe area consistente.
 * En Android usa inset superior calculado (status bar + notch) cuando `edges` incluye `'top'`.
 */
export function AppScreen({
  children,
  style,
  edges = ['bottom', 'left', 'right'],
}: Props) {
  const insets = useSafeAreaInsets();

  if (Platform.OS === 'ios') {
    return (
      <SafeAreaView style={[styles.flex, style]} edges={edges}>
        {children}
      </SafeAreaView>
    );
  }

  const padTop = edges.includes('top') ? resolveTopSafeInset(insets) : 0;
  const padBottom = edges.includes('bottom') ? insets.bottom : 0;
  const padLeft = edges.includes('left') ? insets.left : 0;
  const padRight = edges.includes('right') ? insets.right : 0;

  return (
    <View
      style={[
        styles.flex,
        style,
        {
          paddingTop: padTop,
          paddingBottom: padBottom,
          paddingLeft: padLeft,
          paddingRight: padRight,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
