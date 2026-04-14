import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';

type Props = {
  /** Promedio entre 1 y 5 */
  value: number;
  reviewCount: number;
  emptyLabel?: string;
  /** Al tocar el bloque de calificación / reseñas (solo si hay reseñas) */
  onPressReviews?: () => void;
};

/**
 * Estrellas 1–5 (medias cuando hay decimal) y cantidad de reseñas.
 */
export function StarRating({
  value,
  reviewCount,
  emptyLabel = 'Sin calificaciones aún',
  onPressReviews,
}: Props) {
  const clamped = Math.min(5, Math.max(0, value));

  if (reviewCount <= 0 || clamped <= 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }

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

  const tappable = Boolean(onPressReviews) && reviewCount > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {stars.map((kind, index) => (
          <Ionicons
            key={index}
            name={
              kind === 'full'
                ? 'star'
                : kind === 'half'
                  ? 'star-half'
                  : 'star-outline'
            }
            size={22}
            color={kind === 'empty' ? '#4B5563' : '#FBBF24'}
            style={styles.star}
          />
        ))}
        <Text style={styles.score}>{clamped.toFixed(1)}</Text>
      </View>
      {tappable ? (
        <Pressable
          onPress={onPressReviews}
          style={({ pressed }) => [pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Ver reseñas de clientes"
        >
          <Text style={[styles.reviews, styles.reviewsLink]}>
            {reviewCount} {reviewCount === 1 ? 'reseña' : 'reseñas'}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.reviews}>
          {reviewCount} {reviewCount === 1 ? 'reseña' : 'reseñas'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  pressed: {
    opacity: 0.75,
  },
  center: {
    alignItems: 'center',
    marginTop: spacing.sm,
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
    marginLeft: spacing.sm,
    fontSize: 18,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  reviews: {
    marginTop: spacing.xs,
    fontSize: 14,
    color: colors.textSecondary,
  },
  reviewsLink: {
    textDecorationLine: 'underline',
    fontWeight: '700',
    color: colors.primary,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
