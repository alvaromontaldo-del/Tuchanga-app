import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';

type Props = {
  /** Promedio entre 0 y 5 */
  score?: number | null | undefined;
  reviewCount?: number | null | undefined;
  /** Tamaño del icono de estrella */
  size?: number;
  /** Tamaño del texto (score y conteo). Si se omite, se calcula según `size`. */
  textSize?: number;
  /** Al tocar el bloque de calificación / reseñas (solo si hay reseñas) */
  onPressReviews?: () => void;
  /** Si false, no muestra el conteo entre paréntesis. */
  showCount?: boolean;
  /** Alineación horizontal compacta (p. ej. junto a una etiqueta). */
  inline?: boolean;
};

/**
 * Rating normalizado: [Estrellas] [Promedio] ([Cantidad]).
 * Si no hay reseñas, muestra estrellas vacías y "(0)".
 */
export function StarRating({
  score,
  reviewCount,
  size = 14,
  textSize,
  onPressReviews,
  showCount = true,
  inline = false,
}: Props) {
  const safeScore = typeof score === 'number' && !Number.isNaN(score) ? score : 0;
  const safeCount = typeof reviewCount === 'number' && Number.isFinite(reviewCount) ? reviewCount : 0;
  const clamped = Math.min(5, Math.max(0, safeScore));

  const hasReviews = safeCount > 0;
  const stars: ('full' | 'half' | 'empty')[] = [];
  for (let i = 1; i <= 5; i++) {
    if (clamped >= i) {
      stars.push('full');
    } else if (clamped >= i - 0.5) {
      stars.push('half');
    } else {
      stars.push('empty');
    }
  }

  const tappable = Boolean(onPressReviews) && hasReviews;
  const countText = `(${safeCount})`;
  const resolvedTextSize = Math.max(11, Math.floor(Number(textSize ?? Math.max(12, size - 1)) || 12));
  const wrapStyle = inline ? styles.wrapInline : styles.wrap;

  const Content = (
    <View style={styles.row}>
      {stars.map((kind, index) => (
        <Ionicons
          key={index}
          name={kind === 'full' ? 'star' : kind === 'half' ? 'star-half' : 'star-outline'}
          size={size}
          color={kind === 'empty' ? colors.textSecondary : '#FBBF24'}
          style={styles.star}
        />
      ))}
      <Text style={[styles.score, { fontSize: resolvedTextSize }]}>{clamped.toFixed(1)}</Text>
      {showCount && hasReviews ? (
        <Text style={[styles.count, { fontSize: resolvedTextSize }]}>{countText}</Text>
      ) : null}
    </View>
  );

  if (!tappable) {
    return <View style={wrapStyle}>{Content}</View>;
  }

  return (
    <Pressable
      onPress={onPressReviews}
      style={({ pressed }) => [wrapStyle, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Ver reseñas de clientes"
    >
      {Content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  wrapInline: {
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  star: {
    marginHorizontal: 2,
  },
  score: {
    marginLeft: spacing.xs,
    fontWeight: '800',
    color: colors.text,
  },
  count: {
    marginLeft: spacing.xs,
    color: colors.textSecondary,
    fontWeight: '800',
  },
});
