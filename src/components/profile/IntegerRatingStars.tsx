import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

type Props = {
  /** Entero 1–5 */
  rating: number;
  size?: number;
};

/** Estrellas completas según puntuación entera (reseñas). */
export function IntegerRatingStars({ rating, size = 18 }: Props) {
  const n = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={i <= n ? 'star' : 'star-outline'}
          size={size}
          color={i <= n ? '#FBBF24' : '#4B5563'}
          style={styles.star}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  star: {
    marginRight: 2,
  },
});
