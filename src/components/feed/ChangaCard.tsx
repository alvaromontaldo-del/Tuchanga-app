import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../../constants/theme';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Si se define, la tarjeta completa es pulsable */
  onPress?: () => void;
};

/**
 * Contenedor de lista estándar: padding 16, radio 12, sombra suave, fondo blanco.
 */
export function ChangaCard({ children, style, onPress }: Props) {
  const cardStyle = [styles.root, style];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [cardStyle, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.card,
  },
  pressed: {
    opacity: 0.96,
  },
});
