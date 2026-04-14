import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../constants/theme';

type Props = {
  children: string;
  onPress: () => void;
  align?: 'center' | 'left';
  /** Sin alignSelf: para usar el enlace dentro de una fila con texto al lado */
  inline?: boolean;
};

/** Enlace de texto táctil (login / registro / volver). */
export function TextLink({ children, onPress, align = 'center', inline = false }: Props) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => [
        styles.wrap,
        !inline && (align === 'center' ? styles.alignCenter : styles.alignLeft),
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.text}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: spacing.sm,
  },
  alignCenter: {
    alignSelf: 'center',
  },
  alignLeft: {
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.7,
  },
  text: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
